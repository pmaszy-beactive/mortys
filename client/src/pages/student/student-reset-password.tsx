import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, GraduationCap, AlertCircle, CheckCircle2, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useRoute, Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export default function StudentResetPassword() {
  const [, params] = useRoute("/student/reset-password/:token");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const token = params?.token;

  const [isLoading, setIsLoading] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);

  const { data: tokenValidation, isLoading: isValidating, error: validationError } = useQuery({
    queryKey: [`/api/student/reset-password/${token}/validate`],
    enabled: !!token,
  });

  const form = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: ResetPasswordFormData) => {
    setIsLoading(true);
    
    try {
      await apiRequest("POST", `/api/student/reset-password/${token}`, {
        password: data.password,
      });
      
      setResetComplete(true);
      toast({
        title: "Password reset successful",
        description: "Your password has been updated. You can now log in.",
        variant: "success",
      });

      setTimeout(() => {
        setLocation("/student-login");
      }, 2000);
    } catch (err: any) {
      toast({
        title: "Reset failed",
        description: err.message || "Failed to reset password. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4">
        <Card className="w-full max-w-md backdrop-blur-lg bg-white/95 shadow-2xl border-0">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 text-[#ECC462] animate-spin mb-4" />
            <p className="text-gray-600">Validating reset link...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (validationError || !tokenValidation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4">
        <Card className="w-full max-w-md backdrop-blur-lg bg-white/95 shadow-2xl border-0">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto h-16 w-16 bg-red-100 rounded-full flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
            <CardTitle className="text-2xl font-bold text-[#111111]">
              Invalid or Expired Link
            </CardTitle>
            <CardDescription>
              This password reset link is invalid or has expired. Please request a new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/student/forgot-password">
              <Button className="w-full bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium">
                Request New Reset Link
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (resetComplete) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4">
        <Card className="w-full max-w-md backdrop-blur-lg bg-white/95 shadow-2xl border-0">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto h-16 w-16 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-[#111111]">
              Password Reset Complete!
            </CardTitle>
            <CardDescription>
              Your password has been successfully reset. Redirecting to login...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse delay-700"></div>
      </div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center">
          <div className="mx-auto h-20 w-20 bg-[#ECC462] rounded-2xl shadow-2xl flex items-center justify-center mb-6">
            <GraduationCap className="h-10 w-10 text-[#111111]" />
          </div>
          <h2 className="text-4xl font-bold text-[#111111] mb-2 drop-shadow-lg">
            Set New Password
          </h2>
          <p className="text-amber-900 text-lg">
            Student Portal
          </p>
        </div>

        <Card className="backdrop-blur-lg bg-white/95 shadow-2xl border-0 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#ECC462] via-amber-400 to-[#ECC462]"></div>
          
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-[#111111] to-amber-900 bg-clip-text text-transparent">
              Create New Password
            </CardTitle>
            <CardDescription className="text-base">
              Enter a strong password for your account
            </CardDescription>
          </CardHeader>
          
          <CardContent>
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
                          data-testid="input-password"
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
                          placeholder="Re-enter your password"
                          className="h-11 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                          data-testid="input-confirm-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full h-11 bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg hover:shadow-xl transition-all duration-200"
                  disabled={isLoading}
                  data-testid="button-reset-password"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Resetting Password...
                    </>
                  ) : (
                    <>
                      <Lock className="mr-2 h-5 w-5" />
                      Reset Password
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
