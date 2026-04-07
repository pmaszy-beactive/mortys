import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Shield, AlertCircle, CheckCircle, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type FormData = z.infer<typeof schema>;

export default function AdminForgotPassword() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    setError("");
    try {
      await apiRequest("POST", "/api/auth/forgot-password", data);
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
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
          <h2 className="text-4xl font-bold text-[#111111] mb-2">Reset Password</h2>
          <p className="text-amber-900 text-lg">Morty's Driving School</p>
        </div>

        <Card className="backdrop-blur-lg bg-white/95 shadow-2xl border-0 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#ECC462] via-amber-400 to-[#ECC462]" />

          <CardHeader className="pb-4">
            <CardTitle className="text-2xl font-bold text-[#111111]">Forgot your password?</CardTitle>
            <CardDescription className="text-base">
              Enter your admin email and we'll send you a reset link.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {sent ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-[#111111]">Check your inbox</h3>
                <p className="text-gray-600 text-sm">
                  If that email is registered, a password reset link has been sent. It will expire in 1 hour.
                </p>
                <Link href="/admin/login">
                  <Button className="mt-2 bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Login
                  </Button>
                </Link>
              </div>
            ) : (
              <>
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
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-gray-700 font-medium">Admin Email</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="you@example.com"
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
                          Sending...
                        </>
                      ) : (
                        "Send Reset Link"
                      )}
                    </Button>
                  </form>
                </Form>

                <div className="mt-6 text-center">
                  <Link href="/admin/login">
                    <Button variant="ghost" className="text-amber-900 hover:text-[#111111] hover:bg-[#ECC462]/20">
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to Login
                    </Button>
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
