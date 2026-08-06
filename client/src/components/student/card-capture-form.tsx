import { useEffect, useState } from "react";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import type { Stripe as StripeJs } from "@stripe/stripe-js";
import { Loader2, Lock, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { getStripePromise } from "@/lib/stripe";

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "16px",
      color: "#111111",
      fontFamily: "inherit",
      "::placeholder": { color: "#aab7c4" },
    },
    invalid: { color: "#dc2626" },
  },
};

export interface CardCaptureFormProps {
  /** When set, the card is saved via SetupIntent against the registration (sign-up flow). */
  registrationId?: number;
  /** Capability token from the register response; required with registrationId. */
  cardToken?: string;
  /** Called after the card is successfully saved. */
  onSaved: () => void;
  /** When provided, renders a "Skip for now" link below the save button. */
  onSkip?: () => void;
  saveLabel?: string;
}

function CardCaptureInner({ registrationId, cardToken, onSaved, onSkip, saveLabel }: CardCaptureFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!stripe || !elements) return;
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;
    setSaving(true);
    setError(null);
    try {
      if (registrationId) {
        // Sign-up flow: SetupIntent against the registration's Stripe customer.
        const { clientSecret, setupIntentId } = await apiRequest(
          "POST",
          `/api/student/registration/${registrationId}/setup-intent`,
          { cardToken },
        );
        const result = await stripe.confirmCardSetup(clientSecret, {
          payment_method: { card: cardElement },
        });
        if (result.error) throw new Error(result.error.message || "Card could not be saved");
        await apiRequest("POST", `/api/student/registration/${registrationId}/save-card`, {
          setupIntentId: result.setupIntent?.id || setupIntentId,
          cardToken,
        });
      } else {
        // Logged-in student flow: same path as the billing page's saved cards.
        const result = await stripe.createPaymentMethod({ type: "card", card: cardElement });
        if (result.error) throw new Error(result.error.message || "Card could not be saved");
        await apiRequest("POST", "/api/student/billing/methods/add", {
          paymentMethodId: result.paymentMethod.id,
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e.message || "Failed to save card. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-gray-200 bg-white p-4 focus-within:border-[#ECC462] transition-colors">
        <CardElement options={CARD_ELEMENT_OPTIONS} />
      </div>
      {error && (
        <p className="text-sm text-red-600" data-testid="text-card-error">{error}</p>
      )}
      <Button
        onClick={handleSave}
        disabled={!stripe || saving}
        className="w-full bg-[#111111] hover:bg-[#333] text-[#ECC462] font-semibold"
        data-testid="button-save-card"
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving card...
          </>
        ) : (
          <>
            <CreditCard className="h-4 w-4 mr-2" /> {saveLabel || "Save Card"}
          </>
        )}
      </Button>
      <p className="flex items-center justify-center gap-1 text-xs text-gray-400">
        <Lock className="h-3 w-3" /> Your card details are encrypted and stored securely
      </p>
      {onSkip && (
        <div className="text-center">
          <button
            onClick={onSkip}
            disabled={saving}
            className="text-sm text-gray-400 hover:text-gray-600 py-1 transition-colors underline-offset-2 hover:underline"
            data-testid="button-skip-card"
          >
            Skip for now
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * School-branded card capture form (Stripe Elements styled to match the app).
 * Self-contained: loads Stripe itself so it can be dropped into any page,
 * dialog, or drawer without an ambient <Elements> provider.
 */
export function CardCaptureForm(props: CardCaptureFormProps) {
  const [stripePromise, setStripePromise] = useState<Promise<StripeJs | null> | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    getStripePromise().then((p) => {
      if (mounted) {
        setStripePromise(p ? Promise.resolve(p) : null);
        setReady(true);
      }
    });
    return () => { mounted = false; };
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[#ECC462]" />
      </div>
    );
  }
  if (!stripePromise) {
    return (
      <p className="text-sm text-gray-500 py-4 text-center">
        Card payments are not available right now. {props.onSkip ? "You can continue and add a card later." : "Please try again later."}
      </p>
    );
  }
  return (
    <Elements stripe={stripePromise}>
      <CardCaptureInner {...props} />
    </Elements>
  );
}
