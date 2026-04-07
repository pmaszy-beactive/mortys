import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Shield, AlertCircle, CheckCircle, XCircle } from "lucide-react";
import { Link, useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";

const schema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormData = z.infer<typeof schema>;

type TokenState = "loading" | "valid" | "invalid" | "expired";

export default function AdminResetPassword() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [tokenState, setTokenState] = useState<TokenState>("loading");
  const [firstName, setFirstName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (!token) {
      setTokenState("invalid");
      return;
    }
    fetch(`/api/auth/reset-password/${token}/validate`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
          setFirstName(data.firstName || "Admin");
          setTokenState("valid");
        } else if (data.message?.toLowerCase().includes("expired")) {
          setTokenState("expired");
        } else {
          setTokenState("invalid");
        }
      })
      .catch(() => setTokenState("invalid"));
  }, [token]);

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    setError("");
    try {
      await apiRequest("POST", `/api/auth/reset-password/${token}`, { password: data.password });
      setDone(true);
    } catch (err: any) {
      setError(err.message || "Failed to reset password. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const renderContent = () => {
    if (tokenState === "loading") {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="h-10 w-10 animate-spin text-[#ECC462]" />
          <p className="text-gray-500">Verifying your reset link...</p>
        </div>
      );
    }

    if (tokenState === "expired") {
      return (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <div className="h-16 w-16 bg-orange-100 rounded-full flex items-center justify-center">
            <AlertCircle className="h-8 w-8 text-orange-500" />
          </div>
          <h3 className="text-lg font-semibold text-[#111111]">Link expired</h3>
          <p className="text-gray-600 text-sm">This reset link has expired. Please request a new one.</p>
          <Link href="/admin/forgot-password">
            <Button className="mt-2 bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium">
              Request a New Link
            </Button>
          </Link>
        </div>
      );
    }

    if (tokenState === "invalid") {
      return (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center">
            <XCircle className="h-8 w-8 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-[#111111]">Invalid link</h3>
          <p className="text-gray-600 text-sm">This reset link is invalid or has already been used.</p>
          <Link href="/admin/forgot-password">
            <Button className="mt-2 bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium">
              Request a New Link
            </Button>
          </Link>
        </div>
      );
    }

    if (done) {
      return (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-[#111111]">Password updated!</h3>
          <p className="text-gray-600 text-sm">Your password has been reset successfully.</p>
          <Link href="/admin/login">
            <Button className="mt-2 bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium">
              Go to Login
            </Button>
          </Link>
        </div>
      );
    }

    return (
      <>
        <p className="text-gray-600 text-sm mb-6">
          Hi {firstName}, enter your new password below.
        </p>

        {error && (
          <Alert variant="destructive" className="mb-6 border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-700 font-medium">New Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="At least 8 characters"
                      className="h-11 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                      {...field}
                    />
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
                  <FormLabel className="text-gray-700 font-medium">Confirm Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Repeat your new password"
                      className="h-11 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full h-11 bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Resetting...
                </>
              ) : (
                "Set New Password"
              )}
            </Button>
          </form>
        </Form>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse delay-700" />
      </div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center">
          <div className="mx-auto h-20 w-20 bg-[#ECC462] rounded-2xl shadow-2xl flex items-center justify-center mb-6">
            <Shield className="h-10 w-10 text-[#111111]" />
          </div>
          <h2 className="text-4xl font-bold text-[#111111] mb-2">New Password</h2>
          <p className="text-amber-900 text-lg">Morty's Driving School</p>
        </div>

        <Card className="backdrop-blur-lg bg-white/95 shadow-2xl border-0 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#ECC462] via-amber-400 to-[#ECC462]" />
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl font-bold text-[#111111]">Set a new password</CardTitle>
            <CardDescription className="text-base">Admin Portal — Morty's Driving School</CardDescription>
          </CardHeader>
          <CardContent>{renderContent()}</CardContent>
        </Card>
      </div>
    </div>
  );
}
