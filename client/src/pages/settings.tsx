import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Settings as SettingsIcon, FileText, Hash } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const settingsSchema = z.object({
  nextContractNumber: z.number().min(1, "Contract number must be at least 1"),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

interface AppSettings {
  nextContractNumber: number;
}

export default function Settings() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<AppSettings>({
    queryKey: ["/api/settings"],
    retry: false,
  });

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      nextContractNumber: settings?.nextContractNumber || 1,
    },
  });

  // Update form when settings are loaded
  useState(() => {
    if (settings) {
      form.reset({
        nextContractNumber: settings.nextContractNumber,
      });
    }
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: SettingsFormData) =>
      apiRequest("PUT", "/api/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Settings Updated",
        description: "Application settings have been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SettingsFormData) => {
    updateSettingsMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-amber-50 to-yellow-50">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="animate-pulse space-y-8">
            <div className="h-12 bg-gradient-to-r from-gray-200 to-gray-300 rounded-xl w-1/3"></div>
            <div className="h-64 bg-gradient-to-br from-gray-200 to-gray-300 rounded-2xl"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-amber-50 to-yellow-50">
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">
              Settings
            </h1>
            <SettingsIcon className="h-8 w-8 text-[#ECC462]" />
          </div>
          <p className="text-lg text-gray-600 font-medium">
            Configure application settings and contract management.
          </p>
        </div>

        <div className="space-y-6">
          {/* Contract Settings */}
          <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-shadow duration-300">
            <CardHeader className="border-b bg-gradient-to-r from-amber-50 to-yellow-50 pb-4">
              <CardTitle className="text-2xl font-bold bg-gradient-to-r from-[#ECC462] to-amber-600 bg-clip-text text-transparent flex items-center gap-2">
                <FileText className="h-6 w-6 text-[#ECC462]" />
                Contract Management
              </CardTitle>
              <CardDescription className="mt-1 text-gray-600">
                Configure automatic contract number generation for students.
              </CardDescription>
            </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="nextContractNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-gray-700 font-medium">
                        <Hash className="h-4 w-4 text-amber-600" />
                        Next Contract Number
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                          placeholder="Enter next contract number"
                          className="transition-all duration-200 focus:ring-2 focus:ring-amber-500"
                        />
                      </FormControl>
                      <FormMessage />
                      <p className="text-sm text-gray-500">
                        Contract numbers are automatically assigned to students when they attend their first class.
                        The next student will receive contract number {form.watch('nextContractNumber')}.
                      </p>
                    </FormItem>
                  )}
                />

                <Button 
                  type="submit" 
                  disabled={updateSettingsMutation.isPending}
                  className="w-full sm:w-auto bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg hover:shadow-xl transition-all duration-200"
                >
                  {updateSettingsMutation.isPending ? "Saving..." : "Save Settings"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Information Card */}
        <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-shadow duration-300">
          <CardHeader className="border-b bg-gradient-to-r from-amber-50 to-yellow-50 pb-4">
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-[#ECC462] to-amber-600 bg-clip-text text-transparent">
              How Contract Numbers Work
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-6">
            <div className="space-y-2">
              <h4 className="font-bold text-gray-900">Automatic Assignment</h4>
              <p className="text-sm text-gray-600">
                Contract numbers are automatically generated and assigned to students when their attendance 
                is confirmed for their first class. This ensures every active student receives a unique contract number.
              </p>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-bold text-gray-900">Sequential Numbering</h4>
              <p className="text-sm text-gray-600">
                Contract numbers are assigned sequentially starting from the number you set above. 
                Once assigned, the next contract number is automatically incremented.
              </p>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-bold text-gray-900">No Manual Contracts Tab</h4>
              <p className="text-sm text-gray-600">
                The separate Contracts tab has been removed. Contract information is now integrated 
                directly into student profiles and managed automatically.
              </p>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
}