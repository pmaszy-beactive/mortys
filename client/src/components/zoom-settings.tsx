import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Settings, Video, Clock, Percent } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";

const zoomSettingsSchema = z.object({
  minimumAttendanceMinutes: z.number().min(1).max(480),
  minimumAttendancePercentage: z.number().min(1).max(100),
  autoMarkAttendance: z.boolean(),
  webhookUrl: z.string().url().optional().or(z.literal("")),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
});

type ZoomSettingsFormData = z.infer<typeof zoomSettingsSchema>;

interface ZoomSettings {
  id: number;
  minimumAttendanceMinutes: number;
  minimumAttendancePercentage: number;
  autoMarkAttendance: boolean;
  webhookUrl: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function ZoomSettings() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<ZoomSettings>({
    queryKey: ["/api/zoom/settings"],
  });

  const form = useForm<ZoomSettingsFormData>({
    resolver: zodResolver(zoomSettingsSchema),
    defaultValues: {
      minimumAttendanceMinutes: settings?.minimumAttendanceMinutes || 30,
      minimumAttendancePercentage: settings?.minimumAttendancePercentage || 75,
      autoMarkAttendance: settings?.autoMarkAttendance ?? true,
      webhookUrl: settings?.webhookUrl || "",
      apiKey: settings?.apiKey || "",
      apiSecret: settings?.apiSecret || "",
    },
  });

  // Update form when settings are loaded
  useState(() => {
    if (settings) {
      form.reset({
        minimumAttendanceMinutes: settings.minimumAttendanceMinutes,
        minimumAttendancePercentage: settings.minimumAttendancePercentage,
        autoMarkAttendance: settings.autoMarkAttendance,
        webhookUrl: settings.webhookUrl || "",
        apiKey: settings.apiKey || "",
        apiSecret: settings.apiSecret || "",
      });
    }
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: ZoomSettingsFormData) =>
      apiRequest("PUT", "/api/zoom/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/zoom/settings"] });
      toast({
        title: "Settings Updated",
        description: "Zoom integration settings have been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update Zoom settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ZoomSettingsFormData) => {
    updateSettingsMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Video className="h-6 w-6 text-[#ECC462]" />
        <h2 className="text-2xl font-bold bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">Zoom Integration Settings</h2>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* API Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  API Configuration
                </CardTitle>
                <CardDescription>
                  Configure your Zoom API credentials for meeting creation and attendance tracking.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Key</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder="Your Zoom API Key"
                        />
                      </FormControl>
                      <FormDescription>
                        Your Zoom API Key from the Zoom Marketplace
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="apiSecret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Secret</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder="Your Zoom API Secret"
                        />
                      </FormControl>
                      <FormDescription>
                        Your Zoom API Secret from the Zoom Marketplace
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="webhookUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Webhook URL (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="https://your-domain.com/api/zoom/webhook"
                        />
                      </FormControl>
                      <FormDescription>
                        URL to receive Zoom webhook events for automatic attendance processing
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Attendance Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Attendance Criteria
                </CardTitle>
                <CardDescription>
                  Define the minimum requirements for marking students as present.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="minimumAttendanceMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Attendance (Minutes)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="1"
                          max="480"
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                        />
                      </FormControl>
                      <FormDescription>
                        Minimum minutes a student must attend to be marked present
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="minimumAttendancePercentage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Percent className="h-4 w-4" />
                        Minimum Attendance Percentage
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="1"
                          max="100"
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                        />
                      </FormControl>
                      <FormDescription>
                        Minimum percentage of class time a student must attend
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="autoMarkAttendance"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          Automatic Attendance Marking
                        </FormLabel>
                        <FormDescription>
                          Automatically mark attendance based on Zoom participation data
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-end space-x-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => form.reset()}
            >
              Reset
            </Button>
            <Button
              type="submit"
              disabled={updateSettingsMutation.isPending}
              className="bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg hover:shadow-xl transition-all duration-200"
            >
              {updateSettingsMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      </Form>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>How Zoom Integration Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong>Meeting Creation:</strong> When you schedule a theory class, the system automatically creates a Zoom meeting and adds the join link to the class details.
          </p>
          <p>
            <strong>Attendance Tracking:</strong> After each session, the system retrieves attendance data from Zoom and automatically marks students as present, partial, or absent based on your criteria.
          </p>
          <p>
            <strong>Manual Override:</strong> Admins can manually adjust attendance records for edge cases like connection issues or technical difficulties.
          </p>
          <p>
            <strong>Webhook Integration:</strong> Set up webhooks to automatically process attendance when meetings end, reducing manual work.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}