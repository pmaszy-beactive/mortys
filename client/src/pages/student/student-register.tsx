import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2, GraduationCap, AlertCircle,
  CheckCircle, Clock, RefreshCw, ChevronRight, ChevronLeft, Mail,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { CardCaptureForm } from "@/components/student/card-capture-form";

type FlowStep = "courseType" | "account" | "card" | "verify" | "password";

const COURSE_TYPES = [
  {
    value: "auto",
    label: "Automobile",
    subtitle: "Licence Class 5",
    icon: "🚗",
    description: "Learn to drive a car and earn your Licence Class 5",
  },
  {
    value: "moto",
    label: "Motorcycle",
    subtitle: "Licence Class 6",
    icon: "🏍️",
    description: "Get your motorcycle licence and hit the open road",
  },
  {
    value: "scooter",
    label: "Scooter",
    subtitle: "Licence Class 6D",
    icon: "🛵",
    description: "Scooter training for your Licence Class 6D",
  },
];

const accountSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const passwordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmation: z.string().min(1, "Please confirm your password"),
}).refine((values) => values.password === values.confirmation, {
  message: "Passwords do not match",
  path: ["confirmation"],
});

type AccountFormData = z.infer<typeof accountSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;

export default function StudentRegister() {
  const [flowStep, setFlowStep] = useState<FlowStep>("courseType");
  const [selectedCourseType, setSelectedCourseType] = useState<string | null>(null);
  const [registrationId, setRegistrationId] = useState<number | null>(null);
  const [cardToken, setCardToken] = useState<string | null>(null);
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const calculateSecondsRemaining = useCallback(() => {
    if (!expiresAt) return 0;
    return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  }, [expiresAt]);

  useEffect(() => {
    if (flowStep !== "verify" || !expiresAt) return;
    setSecondsRemaining(calculateSecondsRemaining());
    const interval = setInterval(() => {
      const remaining = calculateSecondsRemaining();
      setSecondsRemaining(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [flowStep, expiresAt, calculateSecondsRemaining]);

  const isCodeExpired = secondsRemaining <= 0 && expiresAt !== null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: { email: "" },
  });
  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirmation: "" },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { email: string }) => {
      return await apiRequest("POST", "/api/student/register", {
        ...data,
        courseType: selectedCourseType,
      });
    },
    onSuccess: (response) => {
      setRegistrationId(response.registrationId);
      sessionStorage.removeItem(`student_registration_token:${response.registrationId}`);
      setEmail(form.getValues("email"));
      if (response.step === "verify") {
        if (response.expiresAt) setExpiresAt(new Date(response.expiresAt));
        setVerificationCode("");
        if (response.cardToken) {
          setCardToken(response.cardToken);
          setFlowStep("card");
        } else {
          // No card capability issued (e.g. resumed registration) — go verify.
          goToVerify();
        }
      }
    },
    onError: (error: any) => {
      toast({
        title: "Registration failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (data: { registrationId: number; code: string }) => {
      return await apiRequest("POST", "/api/student/verify-email", data);
    },
    onSuccess: (response) => {
      if (!registrationId || !response.registrationToken) {
        toast({ title: "Verification failed", description: "Registration access was not issued. Please try again.", variant: "destructive" });
        return;
      }
      sessionStorage.setItem(`student_registration_token:${registrationId}`, response.registrationToken);
      setRegistrationToken(response.registrationToken);
      if (response.passwordSet) {
        setLocation(`/student/onboarding/${registrationId}`);
      } else {
        setFlowStep("password");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Verification failed",
        description: error.message || "Invalid code. Please try again.",
        variant: "destructive",
      });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async (data: PasswordFormData) => {
      if (!registrationId || !registrationToken) throw new Error("Please verify your email again.");
      return apiRequest(
        "POST",
        `/api/student/registration/${registrationId}/password`,
        data,
        { "X-Registration-Token": registrationToken },
      );
    },
    onSuccess: () => setLocation(`/student/onboarding/${registrationId}`),
  });

  const resendMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/student/resend-verification", { registrationId });
    },
    onSuccess: (response) => {
      if (response.expiresAt) setExpiresAt(new Date(response.expiresAt));
      setVerificationCode("");
      toast({ title: "New code sent!", description: "Check your email for the new verification code." });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to resend",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmitAccount = (data: AccountFormData) => {
    registerMutation.mutate({ email: data.email });
  };

  const handleVerify = () => {
    if (registrationId && verificationCode.length === 6) {
      verifyMutation.mutate({ registrationId, code: verificationCode });
    }
  };

  const selectedCourseInfo = COURSE_TYPES.find((c) => c.value === selectedCourseType);

  const STEPS = ["Course", "Email", "Card", "Verify", "Password"];
  const stepIndex =
    flowStep === "courseType" ? 0
    : flowStep === "account" ? 1
    : flowStep === "card" ? 2
    : flowStep === "verify" ? 3
    : 4;

  const goToVerify = () => {
    setFlowStep("verify");
    toast({
      title: "Check your email",
      description: "We sent a 6-digit verification code. If it expired, tap Resend.",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4 py-8 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-lg relative z-10">
        <div className="text-center mb-6">
          <div className="mx-auto h-16 w-16 bg-[#111111] rounded-2xl flex items-center justify-center mb-4 shadow-lg">
            <GraduationCap className="h-9 w-9 text-[#ECC462]" />
          </div>
          <h1 className="text-3xl font-bold text-[#111111]">Register</h1>
          <p className="text-gray-600 mt-1">Morty's Driving School</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center mb-6 gap-1">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center">
              <div
                className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  i === stepIndex
                    ? "bg-[#ECC462] text-[#111111]"
                    : i < stepIndex
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                {i < stepIndex ? (
                  <CheckCircle className="h-3 w-3" />
                ) : (
                  <span>{i + 1}</span>
                )}
                <span className="hidden sm:inline">{label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-4 h-0.5 mx-0.5 ${i < stepIndex ? "bg-green-300" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>

        <Card className="shadow-2xl border-0 bg-white/95 backdrop-blur-lg">
          <CardContent className="pt-6 pb-6">

            {/* ── STEP 1: Course type ─────────────────────────── */}
            {flowStep === "courseType" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold text-[#111111]">What would you like to learn?</h2>
                  <p className="text-gray-500 text-sm mt-1">Choose the type of driving course you're interested in</p>
                </div>
                <div className="space-y-3">
                  {COURSE_TYPES.map((ct) => (
                    <button
                      key={ct.value}
                      data-testid={`card-course-type-${ct.value}`}
                      onClick={() => {
                        setSelectedCourseType(ct.value);
                        setFlowStep("account");
                      }}
                      className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-[#ECC462] hover:bg-amber-50 transition-all text-left group"
                    >
                      <span className="text-4xl">{ct.icon}</span>
                      <div className="flex-1">
                        <div className="font-bold text-[#111111] text-lg">{ct.label}</div>
                        <div className="text-xs font-medium text-[#ECC462] uppercase tracking-wide">{ct.subtitle}</div>
                        <div className="text-sm text-gray-500 mt-0.5">{ct.description}</div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-[#ECC462] transition-colors flex-shrink-0" />
                    </button>
                  ))}
                </div>
                <div className="pt-2 text-center">
                  <span className="text-sm text-gray-500">Already have an account? </span>
                  <Link href="/student/login" className="text-sm font-medium text-[#111111] hover:text-[#ECC462]">
                    Sign in
                  </Link>
                </div>
              </div>
            )}

            {/* ── STEP 2: Account creation ────────────────────── */}
            {flowStep === "account" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setFlowStep("courseType")}
                    className="p-1 rounded hover:text-[#ECC462] transition-colors"
                    data-testid="button-back-to-course-type"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div>
                    <h2 className="text-xl font-bold text-[#111111]">Create Your Account</h2>
                    <p className="text-gray-500 text-sm">Set up your login details to continue</p>
                  </div>
                </div>

                {/* Course summary banner */}
                <div className="p-3 bg-[#111111] rounded-xl flex items-center gap-3">
                  <span className="text-2xl flex-shrink-0">{selectedCourseInfo?.icon}</span>
                  <div className="min-w-0">
                    <div className="text-xs text-[#ECC462] font-medium uppercase tracking-wide">Your selection</div>
                    <div className="text-sm text-white font-semibold">
                      {selectedCourseInfo?.label} — {selectedCourseInfo?.subtitle}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">You'll choose your class date after creating your account</div>
                  </div>
                </div>

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmitAccount)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email Address</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="email"
                              placeholder="you@example.com"
                              data-testid="input-email"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <p className="text-xs text-gray-500">We'll verify your email, then you'll create your password securely.</p>

                    {registerMutation.isError && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          {(registerMutation.error as any)?.message || "Registration failed. Please try again."}
                        </AlertDescription>
                      </Alert>
                    )}

                    <Button
                      type="submit"
                      className="w-full bg-[#111111] hover:bg-[#333] text-[#ECC462] font-semibold py-3"
                      disabled={registerMutation.isPending}
                      data-testid="button-create-account"
                    >
                      {registerMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating account...
                        </>
                      ) : (
                        "Create account & verify email"
                      )}
                    </Button>
                  </form>
                </Form>

                <div className="text-center text-sm text-gray-500">
                  Already have an account?{" "}
                  <Link href="/student/login" className="font-medium text-[#111111] hover:text-[#ECC462]">
                    Sign in
                  </Link>
                </div>
              </div>
            )}

            {/* ── STEP 3: Card on file ─────────────────────────── */}
            {flowStep === "card" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold text-[#111111]">Add a Payment Card</h2>
                  <p className="text-gray-500 text-sm mt-1">
                    A card on file is required to book classes beyond Class #1. You won't be charged now.
                  </p>
                </div>
                {registrationId && cardToken && (
                  <CardCaptureForm
                    registrationId={registrationId}
                    cardToken={cardToken}
                    saveLabel="Save Card & Continue"
                    onSaved={() => {
                      toast({ title: "Card saved", description: "Your card is securely on file." });
                      goToVerify();
                    }}
                    onSkip={goToVerify}
                  />
                )}
              </div>
            )}

            {/* ── STEP 4: Verify email ─────────────────────────── */}
            {flowStep === "verify" && (
              <div className="space-y-5">
                <div className="text-center">
                  <div className="mx-auto h-14 w-14 bg-[#ECC462]/20 rounded-full flex items-center justify-center mb-3">
                    <Mail className="h-7 w-7 text-[#ECC462]" />
                  </div>
                  <h2 className="text-xl font-bold text-[#111111]">Check your email</h2>
                  <p className="text-gray-500 text-sm mt-1">
                    We sent a 6-digit code to{" "}
                    <span className="font-medium text-[#111111]">{email}</span>
                  </p>
                </div>

                {isCodeExpired && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>Your code has expired. Request a new one below.</AlertDescription>
                  </Alert>
                )}

                {!isCodeExpired && secondsRemaining > 0 && (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                    <Clock className="h-4 w-4" />
                    <span>
                      Code expires in{" "}
                      <span className="font-mono font-bold text-[#111111]">{formatTime(secondsRemaining)}</span>
                    </span>
                  </div>
                )}

                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={verificationCode}
                    onChange={setVerificationCode}
                    data-testid="input-otp"
                  >
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                <Button
                  onClick={handleVerify}
                  disabled={verifyMutation.isPending || verificationCode.length !== 6 || isCodeExpired}
                  className="w-full bg-[#111111] hover:bg-[#333] text-[#ECC462] font-semibold py-3"
                  data-testid="button-verify"
                >
                  {verifyMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Verify Email"
                  )}
                </Button>

                <button
                  onClick={() => resendMutation.mutate()}
                  disabled={resendMutation.isPending || (secondsRemaining > 0 && !isCodeExpired)}
                  className="w-full text-sm text-gray-500 hover:text-[#111111] flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  data-testid="button-resend"
                >
                  {resendMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Resend code
                </button>
              </div>
            )}

            {flowStep === "password" && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold text-[#111111]">Create your password</h2>
                  <p className="text-gray-500 text-sm mt-1">Use at least 8 characters. You'll use this password to sign in.</p>
                </div>
                <Form {...passwordForm}>
                  <form onSubmit={passwordForm.handleSubmit((data) => passwordMutation.mutate(data))} className="space-y-4">
                    <FormField
                      control={passwordForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input {...field} type="password" autoComplete="new-password" aria-describedby="password-help" data-testid="input-password" />
                          </FormControl>
                          <p id="password-help" className="text-xs text-gray-500">Minimum 8 characters</p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={passwordForm.control}
                      name="confirmation"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm Password</FormLabel>
                          <FormControl>
                            <Input {...field} type="password" autoComplete="new-password" data-testid="input-password-confirmation" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {passwordMutation.isError && (
                      <Alert variant="destructive" role="alert">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{(passwordMutation.error as Error).message}</AlertDescription>
                      </Alert>
                    )}
                    <Button
                      type="submit"
                      disabled={passwordMutation.isPending}
                      className="w-full bg-[#111111] hover:bg-[#333] text-[#ECC462] font-semibold"
                      data-testid="button-set-password"
                    >
                      {passwordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {passwordMutation.isPending ? "Saving password..." : "Continue to your profile"}
                    </Button>
                  </form>
                </Form>
              </div>
            )}

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
