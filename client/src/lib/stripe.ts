import { loadStripe, type Stripe } from '@stripe/stripe-js';

let _cached: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
  if (!_cached) {
    _cached = fetch('/api/stripe-config')
      .then(r => r.json())
      .then(({ publicKey }: { publicKey: string }) =>
        publicKey ? loadStripe(publicKey) : null
      )
      .catch(() => null);
  }
  return _cached;
}
