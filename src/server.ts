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

// Uses Google Translate's unofficial TTS endpoint (no API key, ~200 char limit per request).
async function synthesizeSpeech(text: string): Promise<string | null> {
  if (!text) {
    return null;
  }

  try {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += 200) {
      chunks.push(text.slice(i, i + 200));
    }

    const buffers: Buffer[] = [];
    for (const chunk of chunks) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=th&q=${encodeURIComponent(chunk)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        console.error('TTS request failed:', response.status);
        return null;
      }

      buffers.push(Buffer.from(await response.arrayBuffer()));
    }

    return Buffer.concat(buffers).toString('base64');
  } catch (error) {
    console.error('TTS synthesis error:', error);
    return null;
  }
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
      const message = paymentIntent.metadata.message;

      const audioContent = await synthesizeSpeech(message);

      broadcast({
        type: 'donation',
        donation: {
          nickname: paymentIntent.metadata.nickname,
          amount: paymentIntent.amount,
          message,
          audioContent
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

    if (!amount || !Number.isFinite(amount) || amount < 10) {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }
    if (!nickname) {
      res.status(400).json({ error: 'Nickname is required' });
      return;
    }

    const unitAmount = Math.round(amount * 100);
    const truncatedMessage = (message || '').slice(0, 500);
    const truncatedNickname = nickname.slice(0, 500);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'promptpay'],
      line_items: [{
        price_data: {
          currency: 'thb',
          product_data: {
            name: 'Donate',
            description: truncatedMessage || undefined,
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin}/success.html`,
      cancel_url: `${req.headers.origin}/cancel.html`,
      payment_intent_data: {
        metadata: {
          nickname: truncatedNickname,
          message: truncatedMessage,
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
app.post('/test-donation', express.json(), async (req, res) => {
  const message = (req.body?.message as string) || 'ทดสอบระบบเสียงอ่านข้อความ';
  const nickname = (req.body?.nickname as string) || 'TestUser123';
  const audioContent = await synthesizeSpeech(message);

  broadcast({
    type: 'donation',
    donation: {
      nickname,
      amount: 1500,
      message,
      audioContent
    }
  });

  res.json({ success: true });
});

router.post('/api/create-payment', createPayment);
app.use(router);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
