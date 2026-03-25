import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Shield, AlertCircle, Sparkles, Award, Home } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function AdminLogin() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "demo",
      password: "demo123",
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setError("");
    
    try {
      const response = await apiRequest("POST", "/api/auth/login", data);
      
      if (response && response.success === true) {
        queryClient.setQueryData(["/api/auth/user"], response.user);
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        
        toast({
          title: "Login successful",
          description: "Welcome to Morty's Driving School Management System!",
        });
        
        setTimeout(() => {
          setLocation("/dashboard");
        }, 100);
      } else {
        setError(response?.message || "Login failed");
      }
    } catch (err: any) {
      setError(err.message || "Login failed. Please check your credentials and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Animated background decorations */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse delay-700"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#111111]/5 rounded-full blur-3xl"></div>
      </div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        {/* Logo and Header */}
        <div className="text-center">
          <div className="mx-auto h-20 w-20 bg-[#ECC462] rounded-2xl shadow-2xl flex items-center justify-center mb-6 transform hover:scale-105 transition-transform duration-300">
            <Shield className="h-10 w-10 text-[#111111]" />
          </div>
          <h2 className="text-4xl font-bold text-[#111111] mb-2 drop-shadow-lg">
            Admin Portal
          </h2>
          <p className="text-amber-900 text-lg mb-4">
            Morty's Driving School
          </p>
          <Link href="/">
            <Button 
              variant="ghost" 
              className="text-amber-900 hover:text-[#111111] hover:bg-[#ECC462]/20"
              data-testid="link-home"
            >
              <Home className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>

        {/* Login Card */}
        <Card className="backdrop-blur-lg bg-white/95 shadow-2xl border-0 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#ECC462] via-amber-400 to-[#ECC462]"></div>
          
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-[#111111] to-amber-900 bg-clip-text text-transparent">
              Welcome Back
            </CardTitle>
            <CardDescription className="text-base">
              Sign in to manage the driving school
            </CardDescription>
          </CardHeader>
          
          <CardContent>
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
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700 font-medium">Username</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder="admin"
                          className="h-11 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                          data-testid="input-username"
                          {...field}
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
                      <FormLabel className="text-gray-700 font-medium">Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Enter your password"
                          className="h-11 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                          data-testid="input-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full h-11 bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-0.5"
                  disabled={isLoading}
                  data-testid="button-submit"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      <Award className="mr-2 h-5 w-5" />
                      Sign In
                    </>
                  )}
                </Button>
              </form>
            </Form>

            {/* Demo Credentials */}
            <div className="mt-6 p-4 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-xl border border-[#ECC462]/30">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-amber-600" />
                <h3 className="text-sm font-semibold text-amber-900">
                  Demo Instructions
                </h3>
              </div>
              <div className="space-y-1 text-sm text-amber-800">
                <p><strong>Username:</strong> demo</p>
                <p><strong>Password:</strong> demo123</p>
                <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  Credentials are pre-filled for your convenience!
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center">
          <p className="text-sm text-amber-900/80">
            Authorized personnel only
          </p>
        </div>
      </div>
    </div>
  );
}
