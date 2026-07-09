import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2, GraduationCap, AlertCircle, Eye, EyeOff,
  CheckCircle, Clock, RefreshCw, ChevronRight, ChevronLeft, Calendar, Mail,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import type { CourseStartDate } from "@shared/schema";

type FlowStep = "courseType" | "startDate" | "account" | "verify" | "redirect";

const COURSE_TYPES = [
  {
    value: "auto",
    label: "Automobile",
    subtitle: "Class 5",
    icon: "🚗",
    description: "Learn to drive a car and earn your Class 5 licence",
  },
  {
    value: "moto",
    label: "Motorcycle",
    subtitle: "Class 6",
    icon: "🏍️",
    description: "Get your motorcycle licence and hit the open road",
  },
  {
    value: "scooter",
    label: "Scooter",
    subtitle: "Class 6D",
    icon: "🛵",
    description: "Scooter training for your Class 6D licence",
  },
];

const accountSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type AccountFormData = z.infer<typeof accountSchema>;

export default function StudentRegister() {
  const [flowStep, setFlowStep] = useState<FlowStep>("courseType");
  const [selectedCourseType, setSelectedCourseType] = useState<string | null>(null);
  const [selectedStartDateId, setSelectedStartDateId] = useState<number | null>(null);
  const [registrationId, setRegistrationId] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: startDates = [], isLoading: datesLoading } = useQuery<CourseStartDate[]>({
    queryKey: ["/api/course-start-dates", selectedCourseType],
    queryFn: async () => {
      if (!selectedCourseType) return [];
      const res = await fetch(`/api/course-start-dates?courseType=${selectedCourseType}`);
      if (!res.ok) throw new Error("Failed to fetch dates");
      return res.json();
    },
    enabled: !!selectedCourseType,
  });

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
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      return await apiRequest("POST", "/api/student/register", {
        ...data,
        courseType: selectedCourseType,
        selectedStartDateId: selectedStartDateId,
      });
    },
    onSuccess: (response) => {
      setRegistrationId(response.registrationId);
      setEmail(form.getValues("email"));
      if (response.step === "verify") {
        if (response.expiresAt) setExpiresAt(new Date(response.expiresAt));
        setVerificationCode("");
        setFlowStep("verify");
        toast({
          title: "Check your email",
          description: "We sent a 6-digit verification code. It expires in 2 minutes.",
        });
      } else if (response.step === "onboarding") {
        setLocation(`/student/onboarding/${response.registrationId}`);
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
    onSuccess: () => {
      setFlowStep("redirect");
      setTimeout(() => setLocation(`/student/onboarding/${registrationId}`), 1500);
    },
    onError: (error: any) => {
      toast({
        title: "Verification failed",
        description: error.message || "Invalid code. Please try again.",
        variant: "destructive",
      });
    },
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
    registerMutation.mutate({ email: data.email, password: data.password });
  };

  const handleVerify = () => {
    if (registrationId && verificationCode.length === 6) {
      verifyMutation.mutate({ registrationId, code: verificationCode });
    }
  };

  const selectedDate = startDates.find((d) => d.id === selectedStartDateId);
  const selectedCourseInfo = COURSE_TYPES.find((c) => c.value === selectedCourseType);

  const STEPS = ["Course", "Start Date", "Account", "Verify"];
  const stepIndex =
    flowStep === "courseType" ? 0
    : flowStep === "startDate" ? 1
    : flowStep === "account" ? 2
    : 3;

  if (flowStep === "redirect") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4">
        <Card className="w-full max-w-md shadow-2xl border-0 bg-white/95">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="mx-auto h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-[#111111] mb-2">Email Verified!</h2>
            <p className="text-gray-600 mb-4">Taking you to complete your profile...</p>
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-[#ECC462]" />
          </CardContent>
        </Card>
      </div>
    );
  }

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
                        setSelectedStartDateId(null);
                        setFlowStep("startDate");
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

            {/* ── STEP 2: Start date ──────────────────────────── */}
            {flowStep === "startDate" && (
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
                    <h2 className="text-xl font-bold text-[#111111]">Choose a Start Date</h2>
                    <p className="text-gray-500 text-sm">
                      {selectedCourseInfo?.icon} {selectedCourseInfo?.label} — {selectedCourseInfo?.subtitle}
                    </p>
                  </div>
                </div>

                {datesLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-[#ECC462]" />
                    <span className="ml-2 text-gray-500">Loading available dates...</span>
                  </div>
                ) : startDates.length === 0 ? (
                  <div className="space-y-4">
                    <div className="p-5 bg-amber-50 border border-amber-200 rounded-xl text-center">
                      <Calendar className="h-8 w-8 text-amber-500 mx-auto mb-2" />
                      <p className="text-sm font-medium text-amber-800">No upcoming start dates right now</p>
                      <p className="text-xs text-amber-600 mt-1">You can still register — we'll reach out with dates soon</p>
                    </div>
                    <Button
                      onClick={() => { setSelectedStartDateId(null); setFlowStep("account"); }}
                      className="w-full bg-[#111111] hover:bg-[#333] text-[#ECC462] font-semibold"
                      data-testid="button-continue-no-date"
                    >
                      Continue without a date <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {startDates.map((sd) => {
                      const dateObj = new Date(`${sd.startDate}T${sd.startTime || "00:00"}:00`);
                      const isSelected = selectedStartDateId === sd.id;
                      return (
                        <button
                          key={sd.id}
                          data-testid={`card-start-date-${sd.id}`}
                          onClick={() => setSelectedStartDateId(sd.id)}
                          className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                            isSelected
                              ? "border-[#ECC462] bg-amber-50"
                              : "border-gray-200 hover:border-[#ECC462] hover:bg-amber-50"
                          }`}
                        >
                          <div
                            className={`h-10 w-10 rounded-full flex-shrink-0 flex items-center justify-center ${
                              isSelected ? "bg-[#ECC462]" : "bg-gray-100"
                            }`}
                          >
                            <Calendar className={`h-5 w-5 ${isSelected ? "text-[#111111]" : "text-gray-500"}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-[#111111]">
                              {dateObj.toLocaleDateString(undefined, {
                                weekday: "long",
                                month: "long",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </div>
                            {sd.startTime && (
                              <div className="text-sm text-gray-500">Starting at {sd.startTime}</div>
                            )}
                            {sd.notes && <div className="text-xs text-gray-400 mt-0.5 truncate">{sd.notes}</div>}
                          </div>
                          {isSelected && (
                            <CheckCircle className="h-5 w-5 text-[#ECC462] flex-shrink-0" />
                          )}
                        </button>
                      );
                    })}

                    <div className="pt-1 space-y-2">
                      <Button
                        onClick={() => setFlowStep("account")}
                        disabled={selectedStartDateId === null}
                        className="w-full bg-[#111111] hover:bg-[#333] text-[#ECC462] font-semibold disabled:opacity-50"
                        data-testid="button-continue-with-date"
                      >
                        Continue <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                      <button
                        onClick={() => { setSelectedStartDateId(null); setFlowStep("account"); }}
                        className="w-full text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors"
                        data-testid="button-skip-date"
                      >
                        I'll choose a date later
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 3: Account creation ────────────────────── */}
            {flowStep === "account" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setFlowStep("startDate")}
                    className="p-1 rounded hover:text-[#ECC462] transition-colors"
                    data-testid="button-back-to-start-date"
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
                    {selectedDate ? (
                      <div className="text-xs text-gray-400 mt-0.5 truncate">
                        Starting{" "}
                        {new Date(`${selectedDate.startDate}T${selectedDate.startTime || "00:00"}:00`).toLocaleDateString(
                          undefined,
                          { month: "long", day: "numeric", year: "numeric" }
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400 mt-0.5">No start date selected yet</div>
                    )}
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
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                {...field}
                                type={showPassword ? "text" : "password"}
                                placeholder="At least 8 characters"
                                data-testid="input-password"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword((v) => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm Password</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                {...field}
                                type={showConfirmPassword ? "text" : "password"}
                                placeholder="Repeat your password"
                                data-testid="input-confirm-password"
                              />
                              <button
                                type="button"
                                onClick={() => setShowConfirmPassword((v) => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              >
                                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

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

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
