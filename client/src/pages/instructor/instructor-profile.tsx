import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { User, Mail, Phone, MapPin, Award, Calendar, Save, ArrowLeft, Car, GraduationCap, BookOpen, Bike, LogOut, PenTool, Bell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useInstructorAuth } from "@/hooks/useInstructorAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import SignaturePad, { type SignaturePadRef } from "@/components/signature-pad";

interface ReminderSettings {
  instructorId: number;
  availabilityReminderEnabled: boolean;
  reminderFrequency: string;
  reminderDayOfWeek: number;
  reminderTime: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

// Helper function to parse specializations
const parseSpecializations = (specializations: any): { type: 'structured' | 'text' | 'empty', data: any } => {
  if (!specializations) return { type: 'empty', data: null };
  
  if (typeof specializations === 'string') {
    const trimmed = specializations.trim();
    if (!trimmed) return { type: 'empty', data: null };
    try {
      const parsed = JSON.parse(trimmed);
      return parseSpecializations(parsed);
    } catch {
      return { type: 'text', data: trimmed };
    }
  }
  
  if (Array.isArray(specializations)) {
    if (specializations.length === 0) return { type: 'empty', data: null };
    const validCourseTypes = ['auto', 'moto', 'scooter'];
    const allCourseTypes = specializations.every((item: any) => 
      typeof item === 'string' && validCourseTypes.includes(item.toLowerCase())
    );
    if (allCourseTypes) {
      const structured: Record<string, { theory: boolean; practical: boolean }> = {};
      specializations.forEach((item: string) => {
        structured[item.toLowerCase()] = { theory: true, practical: true };
      });
      return { type: 'structured', data: structured };
    }
    return { type: 'text', data: specializations.join(', ') };
  }
  
  if (typeof specializations === 'object' && specializations !== null) {
    const keys = Object.keys(specializations);
    if (keys.length === 0) return { type: 'empty', data: null };
    
    const hasStructuredFormat = keys.some(key => 
      typeof specializations[key] === 'object' && 
      (specializations[key].theory !== undefined || specializations[key].practical !== undefined)
    );
    
    if (hasStructuredFormat || keys.some((k: string) => ['auto', 'moto', 'scooter'].includes(k))) {
      return { type: 'structured', data: specializations };
    }
    return { type: 'text', data: Object.values(specializations).join(', ') };
  }
  
  return { type: 'empty', data: null };
};

const profileSchema = z.object({
  phone: z.string().optional(),
  emergencyContact: z.string().optional(),
  emergencyPhone: z.string().optional(),
  notes: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function InstructorProfile() {
  const [isEditing, setIsEditing] = useState(false);
  const { instructor, isLoading, isAuthenticated } = useInstructorAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const signaturePadRef = useRef<SignaturePadRef>(null);

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      phone: instructor?.phone || "",
      emergencyContact: instructor?.emergencyContact || "",
      emergencyPhone: instructor?.emergencyPhone || "",
      notes: instructor?.notes || "",
    },
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/instructor/login");
    }
  }, [isLoading, isAuthenticated, setLocation]);

  const updateProfileMutation = useMutation({
    mutationFn: (data: ProfileFormData) => apiRequest("PUT", "/api/instructor/profile", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/me"] });
      toast({
        title: "Profile updated",
        description: "Your profile has been successfully updated.",
      });
      setIsEditing(false);
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "Failed to update your profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  const saveSignatureMutation = useMutation({
    mutationFn: (signatureData: string) => 
      apiRequest("PUT", "/api/instructor/profile", { digitalSignature: signatureData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/me"] });
      toast({
        title: "Signature saved",
        description: "Your digital signature has been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Save failed",
        description: "Failed to save signature. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSaveSignature = (signature: string) => {
    saveSignatureMutation.mutate(signature);
  };

  // Reminder settings
  const { data: reminderSettings } = useQuery<ReminderSettings>({
    queryKey: ["/api/instructor/reminder-settings"],
    enabled: isAuthenticated,
  });

  const [localReminderSettings, setLocalReminderSettings] = useState<Partial<ReminderSettings>>({});

  useEffect(() => {
    if (reminderSettings) {
      setLocalReminderSettings(reminderSettings);
    }
  }, [reminderSettings]);

  const updateReminderSettingsMutation = useMutation({
    mutationFn: (data: Partial<ReminderSettings>) => 
      apiRequest("PUT", "/api/instructor/reminder-settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/reminder-settings"] });
      toast({
        title: "Settings updated",
        description: "Your reminder settings have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "Failed to update reminder settings.",
        variant: "destructive",
      });
    },
  });

  const handleReminderSettingChange = (key: keyof ReminderSettings, value: any) => {
    const newSettings = { ...localReminderSettings, [key]: value };
    setLocalReminderSettings(newSettings);
    updateReminderSettingsMutation.mutate(newSettings);
  };

  const onSubmit = (data: ProfileFormData) => {
    updateProfileMutation.mutate(data);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      toast({
        title: "Logged out successfully",
        description: "You have been logged out of your account.",
      });
      window.location.href = '/instructor-login';
    } catch (error) {
      console.error('Logout error:', error);
      window.location.href = '/instructor-login';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#ECC462]/10 via-[#ECC462]/5 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-primary mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Loading your profile...</p>
        </div>
      </div>
    );
  }

  if (!instructor) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#ECC462]/10 via-[#ECC462]/5 to-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-700 font-medium">Unable to load profile</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#ECC462]/10 via-[#ECC462]/5 to-white">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-lg shadow-lg border-b border-[#ECC462]/30">
        <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setLocation('/instructor/dashboard')}
                className="hover:bg-[#ECC462]/10 transition-colors"
                data-testid="button-back-dashboard"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-[#ECC462] to-[#ECC462]/90 bg-clip-text text-transparent">
                  My Profile
                </h1>
                <p className="mt-1 text-sm sm:text-base text-gray-600">
                  Manage your personal information and preferences
                </p>
              </div>
            </div>
            <div className="flex space-x-2 sm:space-x-3 w-full sm:w-auto">
              {isEditing ? (
                <>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setIsEditing(false);
                      form.reset();
                    }}
                    className="border-[#ECC462]/40 hover:bg-[#ECC462]/10 transition-colors flex-1 sm:flex-none"
                    data-testid="button-cancel-edit"
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={form.handleSubmit(onSubmit)}
                    disabled={updateProfileMutation.isPending}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200 flex-1 sm:flex-none"
                    data-testid="button-save-profile"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </>
              ) : (
                <Button 
                  onClick={() => setIsEditing(true)}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200 w-full sm:w-auto"
                  data-testid="button-edit-profile"
                >
                  Edit Profile
                </Button>
              )}
              <Button 
                variant="ghost"
                onClick={handleLogout}
                className="text-[#111111] hover:!text-[#ECC462] hover:bg-transparent"
                data-testid="button-logout"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Profile Overview */}
          <div className="lg:col-span-1">
            <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-sm hover:shadow-2xl transition-shadow duration-300">
              <CardHeader className="border-b bg-gradient-to-r from-[#ECC462]/10 to-slate-50">
                <CardTitle className="flex items-center text-gray-900">
                  <User className="mr-2 h-5 w-5 text-[#ECC462]" />
                  Profile Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <div className="text-center">
                  <div className="w-24 h-24 bg-gradient-to-br from-[#ECC462] to-[#ECC462]/90 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg transform hover:scale-105 transition-transform duration-300">
                    <User className="h-12 w-12 text-white" />
                  </div>
                  <h3 className="text-lg font-bold bg-gradient-to-r from-[#ECC462] to-[#ECC462]/90 bg-clip-text text-transparent">
                    {instructor.firstName} {instructor.lastName}
                  </h3>
                  <p className="text-gray-600 text-sm font-medium mt-1">Driving Instructor</p>
                </div>

                <Separator className="bg-[#ECC462]/20" />

                <div className="space-y-3">
                  <div className="flex items-center text-sm p-2 rounded-lg hover:bg-[#ECC462]/10 transition-colors">
                    <div className="bg-[#ECC462]/20 rounded-lg p-2 mr-3 flex-shrink-0">
                      <Mail className="h-4 w-4 text-[#ECC462]" />
                    </div>
                    <span className="text-gray-700 truncate" title={instructor.email}>{instructor.email}</span>
                  </div>
                  
                  {instructor.phone && (
                    <div className="flex items-center text-sm p-2 rounded-lg hover:bg-[#ECC462]/10 transition-colors">
                      <div className="bg-[#ECC462]/20 rounded-lg p-2 mr-3 flex-shrink-0">
                        <Phone className="h-4 w-4 text-[#ECC462]" />
                      </div>
                      <span className="text-gray-700 truncate">{instructor.phone}</span>
                    </div>
                  )}

                  {instructor.locationAssignment && (
                    <div className="flex items-center text-sm p-2 rounded-lg hover:bg-[#ECC462]/10 transition-colors">
                      <div className="bg-[#ECC462]/20 rounded-lg p-2 mr-3 flex-shrink-0">
                        <MapPin className="h-4 w-4 text-[#ECC462]" />
                      </div>
                      <span className="text-gray-700 truncate">{instructor.locationAssignment}</span>
                    </div>
                  )}

                  {instructor.hireDate && (
                    <div className="flex items-center text-sm p-2 rounded-lg hover:bg-[#ECC462]/10 transition-colors">
                      <div className="bg-[#ECC462]/20 rounded-lg p-2 mr-3 flex-shrink-0">
                        <Calendar className="h-4 w-4 text-[#ECC462]" />
                      </div>
                      <span className="text-gray-700 truncate">Joined {new Date(instructor.hireDate).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>

                <Separator className="bg-[#ECC462]/20" />

                {/* Specializations - Modern Redesign */}
                <div>
                  <div className="flex items-center mb-4">
                    <div className="bg-gradient-to-br from-[#ECC462] to-[#ECC462]/90 rounded-xl p-2.5 mr-3 shadow-lg">
                      <Award className="h-5 w-5 text-white" />
                    </div>
                    <h3 className="text-base font-bold text-gray-900">Certifications & Specializations</h3>
                  </div>
                  <div className="space-y-3">
                    {(() => {
                      const parsed = parseSpecializations(instructor.specializations);
                      
                      if (parsed.type === 'empty') {
                        return (
                          <div className="text-center py-6 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                            <p className="text-sm text-gray-500">No specializations listed</p>
                          </div>
                        );
                      }
                      
                      if (parsed.type === 'text') {
                        if (typeof parsed.data === 'string') {
                          const specs = parsed.data.split(',').map(s => s.trim());
                          return (
                            <div className="grid grid-cols-1 gap-2">
                              {specs.map((spec, index) => (
                                <div key={index} className="flex items-center p-3 bg-gradient-to-r from-[#ECC462]/10 to-slate-50 rounded-lg border border-[#ECC462]/30 hover:border-[#ECC462]/50 hover:shadow-md transition-all duration-200 group">
                                  <div className="w-2 h-2 bg-[#ECC462] rounded-full mr-3"></div>
                                  <span className="text-sm font-medium text-gray-800 group-hover:text-[#111111] transition-colors">{spec}</span>
                                </div>
                              ))}
                            </div>
                          );
                        }
                        return (
                          <div className="flex items-center p-3 bg-gradient-to-r from-[#ECC462]/10 to-slate-50 rounded-lg border border-[#ECC462]/30">
                            <div className="w-2 h-2 bg-[#ECC462] rounded-full mr-3"></div>
                            <span className="text-sm font-medium text-gray-800">{String(parsed.data)}</span>
                          </div>
                        );
                      }
                      
                      if (parsed.type === 'structured') {
                        const certifications: JSX.Element[] = [];
                        
                        Object.entries(parsed.data).forEach(([courseType, details]: [string, any]) => {
                          const courseInfo = {
                            auto: { 
                              label: 'Automobile', 
                              icon: Car, 
                              gradient: 'from-[#ECC462] to-amber-500',
                              bgGradient: 'from-[#ECC462]/10 to-amber-50',
                              borderColor: 'border-[#ECC462] hover:border-amber-400'
                            },
                            moto: { 
                              label: 'Motorcycle', 
                              icon: Bike, 
                              gradient: 'from-amber-600 to-yellow-700',
                              bgGradient: 'from-amber-100 to-yellow-50',
                              borderColor: 'border-amber-400 hover:border-yellow-500'
                            },
                            scooter: { 
                              label: 'Scooter', 
                              icon: Bike, 
                              gradient: 'from-[#111111] to-gray-800',
                              bgGradient: 'from-gray-100 to-slate-50',
                              borderColor: 'border-gray-300 hover:border-gray-400'
                            }
                          };
                          
                          const info = courseInfo[courseType as keyof typeof courseInfo] || {
                            label: courseType,
                            icon: GraduationCap,
                            gradient: 'from-gray-500 to-gray-600',
                            bgGradient: 'from-gray-50 to-gray-100',
                            borderColor: 'border-gray-200 hover:border-gray-400'
                          };
                          
                          const IconComponent = info.icon;
                          const hasTheory = details?.theory;
                          const hasPractical = details?.practical;
                          
                          certifications.push(
                            <div 
                              key={courseType} 
                              className={`p-4 bg-gradient-to-br ${info.bgGradient} rounded-xl border-2 ${info.borderColor} hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5 group`}
                              data-testid={`card-specialization-${courseType}`}
                            >
                              <div className="flex items-center mb-3">
                                <div className={`w-10 h-10 bg-gradient-to-br ${info.gradient} rounded-lg flex items-center justify-center mr-3 shadow-lg group-hover:scale-110 transition-transform`}>
                                  <IconComponent className="h-5 w-5 text-white" />
                                </div>
                                <h4 className="font-bold text-gray-900">{info.label}</h4>
                              </div>
                              {(hasTheory || hasPractical) ? (
                                <div className="flex gap-2">
                                  {hasTheory && (
                                    <Badge className="bg-gradient-to-r from-[#ECC462] to-[#ECC462]/90 text-[#111111] border-0 hover:shadow-md transition-all flex items-center gap-1.5 px-3 py-1 font-semibold" data-testid={`badge-theory-${courseType}`}>
                                      <BookOpen className="h-3.5 w-3.5" />
                                      Theory
                                    </Badge>
                                  )}
                                  {hasPractical && (
                                    <Badge className="bg-gradient-to-r from-[#ECC462] to-[#ECC462]/90 text-[#111111] border-0 hover:shadow-md transition-all flex items-center gap-1.5 px-3 py-1 font-semibold" data-testid={`badge-driving-${courseType}`}>
                                      <GraduationCap className="h-3.5 w-3.5" />
                                      Driving
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <Badge className="bg-gradient-to-r from-[#ECC462] to-[#ECC462]/90 text-[#111111] border-0 hover:shadow-md transition-all flex items-center gap-1.5 px-3 py-1 font-semibold" data-testid={`badge-certified-${courseType}`}>
                                  <Award className="h-3.5 w-3.5" />
                                  Certified
                                </Badge>
                              )}
                            </div>
                          );
                        });
                        
                        return certifications.length > 0 ? (
                          <div className="grid grid-cols-1 gap-3">
                            {certifications}
                          </div>
                        ) : (
                          <div className="text-center py-6 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                            <p className="text-sm text-gray-500">No specializations listed</p>
                          </div>
                        );
                      }
                      
                      return (
                        <div className="text-center py-6 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                          <p className="text-sm text-gray-500">No specializations listed</p>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Status */}
                <div>
                  <p className="text-sm font-bold text-gray-900 mb-2">Status</p>
                  <Badge 
                    variant={instructor.status === 'active' ? 'default' : 'secondary'} 
                    className="shadow-md hover:shadow-lg transition-shadow"
                  >
                    {instructor.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Editable Information */}
          <div className="lg:col-span-2">
            <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-sm hover:shadow-2xl transition-shadow duration-300">
              <CardHeader className="border-b bg-gradient-to-r from-[#ECC462]/10 to-slate-50">
                <CardTitle className="text-gray-900">Personal Information</CardTitle>
                <CardDescription className="text-gray-600">
                  Update your contact information and emergency details
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-gray-700 font-semibold">Phone Number</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="(555) 123-4567"
                                disabled={!isEditing}
                                className={!isEditing ? "bg-gray-50 border-gray-200" : "border-[#ECC462]/40 focus:border-[#ECC462] focus:ring-[#ECC462]"}
                                data-testid="input-phone"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-gray-700">
                          License Number
                        </label>
                        <Input
                          value={instructor.instructorLicenseNumber || "Not specified"}
                          disabled
                          className="bg-gradient-to-r from-gray-50 to-[#ECC462]/10 border-[#ECC462]/30"
                          data-testid="input-license-number"
                        />
                      </div>
                    </div>

                    <Separator className="bg-[#ECC462]/20" />

                    <div className="space-y-4">
                      <h3 className="text-lg font-bold bg-gradient-to-r from-[#ECC462] to-[#ECC462]/90 bg-clip-text text-transparent">
                        Emergency Contact
                      </h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="emergencyContact"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700 font-semibold">Emergency Contact Name</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="John Doe"
                                  disabled={!isEditing}
                                  className={!isEditing ? "bg-gray-50 border-gray-200" : "border-[#ECC462]/40 focus:border-[#ECC462] focus:ring-[#ECC462]"}
                                  data-testid="input-emergency-contact"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="emergencyPhone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700 font-semibold">Emergency Phone</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="(555) 987-6543"
                                  disabled={!isEditing}
                                  className={!isEditing ? "bg-gray-50 border-gray-200" : "border-[#ECC462]/40 focus:border-[#ECC462] focus:ring-[#ECC462]"}
                                  data-testid="input-emergency-phone"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <Separator className="bg-[#ECC462]/20" />

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-gray-700 font-semibold">Notes</FormLabel>
                          <FormControl>
                            <Textarea
                              data-testid="textarea-notes"
                              placeholder="Add any personal notes or preferences..."
                              className={!isEditing ? "min-h-[120px] bg-gray-50 border-gray-200" : "min-h-[120px] border-[#ECC462]/40 focus:border-[#ECC462] focus:ring-[#ECC462]"}
                              disabled={!isEditing}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </form>
                </Form>
              </CardContent>
            </Card>

            {/* Digital Signature Section */}
            <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-sm hover:shadow-2xl transition-shadow duration-300 mt-6">
              <CardHeader className="border-b bg-gradient-to-r from-[#ECC462]/10 to-slate-50">
                <CardTitle className="flex items-center text-gray-900">
                  <PenTool className="mr-2 h-5 w-5 text-[#ECC462]" />
                  Digital Signature
                </CardTitle>
                <CardDescription className="text-gray-600">
                  Draw your signature to be used in all student evaluations
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                {instructor.digitalSignature ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 mb-2">Current Signature:</p>
                      <div className="border-2 border-[#ECC462]/30 rounded-lg p-4 bg-gray-50">
                        <img 
                          src={instructor.digitalSignature} 
                          alt="Instructor Signature" 
                          className="max-w-full h-auto max-h-32"
                          data-testid="img-current-signature"
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 mb-2">Update Signature:</p>
                      <SignaturePad
                        ref={signaturePadRef}
                        onSave={handleSaveSignature}
                        title=""
                        height={150}
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-600 mb-4">
                      You haven't saved a signature yet. Draw your signature below and click save.
                    </p>
                    <SignaturePad
                      ref={signaturePadRef}
                      onSave={handleSaveSignature}
                      title=""
                      height={150}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Availability Reminder Settings */}
            <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-sm hover:shadow-2xl transition-shadow duration-300 mt-6">
              <CardHeader className="border-b bg-gradient-to-r from-[#ECC462]/10 to-slate-50">
                <CardTitle className="flex items-center text-gray-900">
                  <Bell className="mr-2 h-5 w-5 text-[#ECC462]" />
                  Availability Reminders
                </CardTitle>
                <CardDescription className="text-gray-600">
                  Configure when you receive reminders to update your availability
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                {/* Enable/Disable Reminders */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-base font-medium">Enable Reminders</Label>
                    <p className="text-sm text-gray-500">
                      Get notified when it's time to update your availability
                    </p>
                  </div>
                  <Switch
                    checked={localReminderSettings.availabilityReminderEnabled ?? true}
                    onCheckedChange={(checked) => handleReminderSettingChange('availabilityReminderEnabled', checked)}
                    data-testid="switch-reminder-enabled"
                  />
                </div>

                <Separator />

                {/* Reminder Frequency */}
                <div className="space-y-2">
                  <Label className="text-base font-medium">Reminder Frequency</Label>
                  <Select
                    value={localReminderSettings.reminderFrequency || 'weekly'}
                    onValueChange={(value) => handleReminderSettingChange('reminderFrequency', value)}
                    disabled={!localReminderSettings.availabilityReminderEnabled}
                  >
                    <SelectTrigger className="w-full" data-testid="select-frequency">
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Every 2 Weeks</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Day of Week (for weekly/biweekly) */}
                {(localReminderSettings.reminderFrequency === 'weekly' || 
                  localReminderSettings.reminderFrequency === 'biweekly') && (
                  <div className="space-y-2">
                    <Label className="text-base font-medium">Reminder Day</Label>
                    <Select
                      value={String(localReminderSettings.reminderDayOfWeek ?? 0)}
                      onValueChange={(value) => handleReminderSettingChange('reminderDayOfWeek', parseInt(value))}
                      disabled={!localReminderSettings.availabilityReminderEnabled}
                    >
                      <SelectTrigger className="w-full" data-testid="select-day">
                        <SelectValue placeholder="Select day" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Sunday</SelectItem>
                        <SelectItem value="1">Monday</SelectItem>
                        <SelectItem value="2">Tuesday</SelectItem>
                        <SelectItem value="3">Wednesday</SelectItem>
                        <SelectItem value="4">Thursday</SelectItem>
                        <SelectItem value="5">Friday</SelectItem>
                        <SelectItem value="6">Saturday</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <Separator />

                {/* Notification Channels */}
                <div className="space-y-4">
                  <Label className="text-base font-medium">Notification Channels</Label>
                  
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">Email Notifications</p>
                      <p className="text-xs text-gray-500">Receive reminders via email</p>
                    </div>
                    <Switch
                      checked={localReminderSettings.emailEnabled ?? true}
                      onCheckedChange={(checked) => handleReminderSettingChange('emailEnabled', checked)}
                      disabled={!localReminderSettings.availabilityReminderEnabled}
                      data-testid="switch-email-enabled"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">In-App Notifications</p>
                      <p className="text-xs text-gray-500">See reminders in the dashboard</p>
                    </div>
                    <Switch
                      checked={localReminderSettings.inAppEnabled ?? true}
                      onCheckedChange={(checked) => handleReminderSettingChange('inAppEnabled', checked)}
                      disabled={!localReminderSettings.availabilityReminderEnabled}
                      data-testid="switch-inapp-enabled"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}