import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, GraduationCap, Mail, CheckCircle2, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

export default function StudentForgotPassword() {
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const { toast } = useToast();

  const form = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setIsLoading(true);
    
    try {
      await apiRequest("POST", "/api/student/forgot-password", data);
      
      setEmailSent(true);
      toast({
        title: "Email sent",
        description: "Check your inbox for password reset instructions.",
        variant: "success",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to send reset email. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse delay-700"></div>
        </div>

        <Card className="w-full max-w-md backdrop-blur-lg bg-white/95 shadow-2xl border-0 relative z-10">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#ECC462] via-amber-400 to-[#ECC462]"></div>
          
          <CardHeader className="text-center space-y-4 pb-6">
            <div className="mx-auto h-16 w-16 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-[#111111]">
              Check Your Email
            </CardTitle>
            <CardDescription className="text-base">
              We've sent password reset instructions to <strong>{form.getValues("email")}</strong>
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50">
              <Mail className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-900">
                The email may take a few minutes to arrive. Please check your spam folder if you don't see it.
              </AlertDescription>
            </Alert>

            <Link href="/student-login" className="block mt-6">
              <Button
                className="w-full bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium"
                data-testid="button-back-to-login"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Login
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse delay-700"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#111111]/5 rounded-full blur-3xl"></div>
      </div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center">
          <div className="mx-auto h-20 w-20 bg-[#ECC462] rounded-2xl shadow-2xl flex items-center justify-center mb-6 transform hover:scale-105 transition-transform duration-300">
            <GraduationCap className="h-10 w-10 text-[#111111]" />
          </div>
          <h2 className="text-4xl font-bold text-[#111111] mb-2 drop-shadow-lg">
            Reset Password
          </h2>
          <p className="text-amber-900 text-lg">
            Student Portal
          </p>
        </div>

        <Card className="backdrop-blur-lg bg-white/95 shadow-2xl border-0 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#ECC462] via-amber-400 to-[#ECC462]"></div>
          
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-[#111111] to-amber-900 bg-clip-text text-transparent">
              Forgot Your Password?
            </CardTitle>
            <CardDescription className="text-base">
              Enter your email address and we'll send you instructions to reset your password
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700 font-medium">Email Address</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="student@example.com"
                          className="h-11 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                          data-testid="input-email"
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
                  data-testid="button-send-reset-link"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-5 w-5" />
                      Send Reset Link
                    </>
                  )}
                </Button>
              </form>
            </Form>

            <div className="mt-6 text-center">
              <Link href="/student-login">
                <a className="text-sm text-[#ECC462] hover:text-amber-600 font-medium inline-flex items-center gap-2 transition-colors">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Login
                </a>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
