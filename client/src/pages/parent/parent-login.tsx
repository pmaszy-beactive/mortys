import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Users, AlertCircle, Home } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function ParentLogin() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setError("");
    
    try {
      const response = await apiRequest("POST", "/api/parent/login", data);
      
      if (response.success) {
        await queryClient.invalidateQueries({ queryKey: ["/api/parent/me"] });
        
        toast({
          title: "Login successful",
          description: `Welcome back, ${response.parent.firstName}!`,
        });
        
        if (response.requiresStudentSelection) {
          sessionStorage.setItem("linkedStudents", JSON.stringify(response.linkedStudents));
          setLocation("/parent/select-student");
        } else if (response.linkedStudents?.length === 1) {
          const studentId = response.linkedStudents[0].studentId;
          await apiRequest("POST", "/api/parent/select-student", { studentId });
          setLocation("/parent/dashboard");
        } else {
          setLocation("/parent/dashboard");
        }
      } else {
        setError(response.message || "Login failed");
      }
    } catch (err: any) {
      setError(err.message || "Login failed. Please check your credentials and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center">
          <div className="mx-auto h-20 w-20 bg-[#ECC462] rounded-md shadow-sm flex items-center justify-center mb-6">
            <Users className="h-10 w-10 text-[#111111]" />
          </div>
          <h2 className="text-4xl font-bold text-gray-900 mb-2">
            Parent Portal
          </h2>
          <p className="text-gray-600 text-lg mb-4">
            Morty's Driving School
          </p>
          <Link href="/">
            <Button 
              variant="ghost" 
              className="text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md"
              data-testid="link-home"
            >
              <Home className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>

        <Card className="bg-white shadow-sm border border-gray-200 rounded-md overflow-hidden">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-bold text-gray-900">
              Welcome Back
            </CardTitle>
            <CardDescription className="text-base text-gray-500">
              Sign in to view your student's progress
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-6 border-red-200 bg-red-50 rounded-md">
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
                      <FormLabel className="text-gray-700 font-medium">Email Address</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="parent@example.com"
                          className="h-11 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462] rounded-md"
                          data-testid="input-email"
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
                          className="h-11 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462] rounded-md"
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
                  className="w-full h-12 bg-[#111111] hover:bg-[#111111]/90 text-white font-semibold text-lg rounded-md transition-colors"
                  disabled={isLoading}
                  data-testid="button-submit"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            </Form>

            <div className="mt-6 text-center border-t border-gray-100 pt-6">
              <p className="text-sm text-gray-600">
                Don't have an account?{" "}
                <span className="text-gray-900 font-medium">
                  Contact the school to get an invitation link.
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
