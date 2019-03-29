import React from 'react';
import QRCode from 'qrcode.react';
import { requestProvider } from 'webln';
import Loader from './Loader';
import api, { Order } from '../lib/api';
import { MESSAGE, SIZE } from '../../server/constants';
import './Payment.scss';

interface Props {
  signature: string;
  size: SIZE;
  onPayment(order: Order): void;
}

interface State {
  order: Order | null;
  isGettingOrder: boolean;
  getOrderError: string;
  isWeblnPaying: boolean;
  weblnPayError: string;
  hasPaid: boolean;
  hasExpired: boolean;
  existingOrder: boolean;
}

export default class Payment extends React.PureComponent<Props, State> {
  state: State = {
    order: null,
    isGettingOrder: true,
    getOrderError: '',
    isWeblnPaying: false,
    weblnPayError: '',
    hasPaid: false,
    hasExpired: false,
    existingOrder: false,
  };

  componentDidMount() {
    this.getOrder();
  }

  render() {
    const { order, isGettingOrder, isWeblnPaying, getOrderError, hasPaid, hasExpired, existingOrder } = this.state;

    let content;
    if (hasPaid) {
      content = (
        <>
          <div className="Payment-success">
            <h3 className="title">Success!</h3>
            <p className="Payment-success-text">
              Your payment has been received
            </p>
            <button
              className="Payment-success-continue button is-primary is-medium"
              onClick={() => this.props.onPayment(order as Order)}
            >
              Continue to shipping info
            </button>
          </div>
        </>
      )
    } else if (hasExpired) {
      content = (
        <>
          <div className="notification is-danger">
            Your order has expired. You can return to the homepage to try again.
            If you experienced routing issues, you can try to open a channel
            with our node.
          </div>
          <a href="/" className="button is-primary">
            Start over
          </a>
        </>
      );
    } else if (isGettingOrder) {
      content = <Loader message="Getting order details..." />
    } else if (isWeblnPaying) {
      content = <Loader message="Sending payment with WebLN..." />
    } else if (order) {
      content = (
        <div className="Payment-order">
          <a href={`lightning:${order.paymentRequest}`} className="Payment-order-qr">
            <QRCode value={order.paymentRequest.toUpperCase()} />
            <small className="Payment-order-qr-hint">
              Click to open in wallet
            </small>
          </a>
          <input className="input" readOnly value={order.paymentRequest} />
        </div>
      );
    } else if (getOrderError) {
      content = (
        <>
          <div className="notification is-danger">
            <button className="delete" onClick={this.closeError} />
            {getOrderError}
          </div>
          <button className="button is-primary" onClick={this.getOrder}>
            Try again
          </button>
        </>
      );
    }

    return (
      <div className="Payment">
        {content}
      </div>
    )
  }

  private getOrder = async () => {
    const { signature, size } = this.props;
    try {
      const order = await api.createOrGetOrder({
        size,
        signature,
        message: MESSAGE,
      });
      this.setState({
        order,
        isGettingOrder: false,
      }, () => {
        if (order.hasPaid) {
          this.setState({
            hasPaid: true,
            existingOrder: true,
          });
        } else {
          this.subscribeToOrder(order);
          this.weblnPay();
        }
      });
    } catch(err) {
      console.error(err);
      this.setState({
        isGettingOrder: false,
        getOrderError: err.message || err.toString(),
      });
    }
  };

  private weblnPay = async () => {
    // Ensure we have the order first
    const { order } = this.state;
    if (!order) {
      return;
    }

    // If we don't have WebLN, fall back to qr code and such
    let webln;
    try {
      webln = await requestProvider();
    } catch(err) {
      console.warn('WebLN is unavailable');
      this.setState({ isWeblnPaying: false });
      return;
    }

    // If we do, try to send with WebLN
    this.setState({ isWeblnPaying: true });
    try {
      await webln.sendPayment(order.paymentRequest);
    } catch(err) {
      this.setState({
        isWeblnPaying: false,
        weblnPayError: `Payment failed: ${err.message || err}`,
      })
    }
  };

  private subscribeToOrder = (order: Order) => {
    const ws = api.subscribeToOrder(order.id);
    ws.addEventListener('message', ev => {
      const data = JSON.parse(ev.data.toString());
      if (data.success) {
        this.setState({ hasPaid: true }, () => ws.close());
      }
      if (data.expired) {
        this.setState({ hasExpired: true }, () => ws.close());
      }
      if (data.error) {
        this.setState({ getOrderError: data.error }, () => ws.close());
      }
    });
    ws.addEventListener('close', () => {
      if (!this.state.hasPaid || !this.state.hasExpired) {
        this.setState({ getOrderError: 'Something went wrong while waiting for payment' });
      }
    });
  };

  private closeError = () => {
    this.setState({ getOrderError: '' });
  };
}