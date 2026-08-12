import express, { Router, RequestHandler } from 'express';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';

dotenv.config();

interface PaymentRequest {
  nickname: string;
  amount: number;
  message?: string;
}

const app: express.Application = express();
const router: Router = express.Router();
const PORT = process.env.PORT || 3000;
const server = createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set<WebSocket>();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-07-29.dahlia'
});

wss.on('connection', (ws: WebSocket) => {
  clients.add(ws);
  console.log('New WebSocket connection');

  ws.on('close', () => {
    clients.delete(ws);
    console.log('WebSocket connection closed');
  });
});

function broadcast(data: any): void {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Registered before express.json() so the raw body reaches Stripe's signature verification unparsed.
app.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;

      broadcast({
        type: 'donation',
        donation: {
          nickname: paymentIntent.metadata.nickname,
          amount: paymentIntent.amount,
          message: paymentIntent.metadata.message
        }
      });
    }

    res.json({ received: true });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const createPayment: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const { amount, nickname, message } = req.body as PaymentRequest;

    if (!amount || amount < 10) {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }
    if (!nickname) {
      res.status(400).json({ error: 'Nickname is required' });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      line_items: [{
        price_data: {
          currency: 'thb',
          product_data: {
            name: 'Donate',
            description: message || undefined,
          },
          unit_amount: amount * 100,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin}/success.html`,
      cancel_url: `${req.headers.origin}/cancel.html`,
      payment_intent_data: {
        metadata: {
          nickname,
          message: message || '',
        }
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    }
    next(error);
  }
};

// Test endpoint
app.post('/test-donation', express.json(), (req, res) => {
  broadcast({
    type: 'donation',
    donation: {
      nickname: 'TestUser123',
      amount: 1500,
      message: 'ทดสอบระบบเสียงอ่านข้อความ'
    }
  });

  res.json({ success: true });
});

router.post('/api/create-payment', createPayment);
app.use(router);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
