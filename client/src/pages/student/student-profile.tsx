import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, User, Mail, Phone, Globe, MapPin, Users, AlertCircle, CheckCircle2, Upload, ArrowLeft, FileText, Trash2, Download, Clock, XCircle, Bell, CreditCard, Calendar, MessageSquare, Image, Heart } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import type { StudentDocument } from "@shared/schema";

const contactTypeOptions = [
  { value: "preferred", label: "Preferred Contact" },
  { value: "secondary", label: "Secondary Contact" },
  { value: "additional", label: "Additional Contact" },
];

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Please enter a valid email address"),
  emailContactType: z.string().default("preferred"),
  phone: z.string().min(10, "Please enter a valid phone number"),
  phoneContactType: z.string().default("preferred"),
  homePhone: z.string().optional(),
  homePhoneContactType: z.string().default("additional"),
  primaryLanguage: z.string().min(1, "Please select a language"),
  address: z.string().min(1, "Address is required"),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  province: z.string().optional(),
  emergencyContact: z.string().min(1, "Emergency contact name is required"),
  emergencyPhone: z.string().min(10, "Emergency contact phone is required"),
  specialNeeds: z.string().optional(),
  accommodations: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

interface StudentProfileData extends ProfileFormData {
  id?: number;
  profilePhoto?: string;
}

export default function StudentProfile() {
  const [, setLocation] = useLocation();
  const { student, isLoading: authLoading, isAuthenticated } = useStudentAuth();
  const { toast } = useToast();
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadDocType, setUploadDocType] = useState("photo_id");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: profileData, isLoading: profileLoading } = useQuery<StudentProfileData>({
    queryKey: ["/api/student/profile"],
    enabled: isAuthenticated,
  });

  const { data: documents = [], isLoading: documentsLoading } = useQuery<StudentDocument[]>({
    queryKey: ["/api/student/documents"],
    enabled: isAuthenticated,
  });

  // Notification preferences query
  interface NotificationPreferences {
    emailNotificationsEnabled: boolean;
    smsNotificationsEnabled: boolean;
    notifyUpcomingClasses: boolean;
    upcomingClassReminderTime: string;
    notifyScheduleChanges: boolean;
    notifyScheduleOpenings: boolean;
    notifyPaymentReceipts: boolean;
  }

  const { data: notificationPrefs, isLoading: notificationPrefsLoading } = useQuery<NotificationPreferences>({
    queryKey: ["/api/student/notifications/preferences"],
    enabled: isAuthenticated,
  });

  // Permit info query
  interface PermitInfo {
    learnerPermitNumber: string;
    learnerPermitValidDate: string;
    learnerPermitExpiryDate: string;
    learnerPermitPhoto: string | null;
    driverLicenseNumber: string;
    licenseExpiryDate: string;
  }

  const { data: permitInfo, isLoading: permitInfoLoading } = useQuery<PermitInfo>({
    queryKey: ["/api/student/permit"],
    enabled: isAuthenticated,
  });

  // State for permit form
  const [permitNumber, setPermitNumber] = useState("");
  const [permitValidDate, setPermitValidDate] = useState("");
  const [permitExpiry, setPermitExpiry] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [permitPhotoPreview, setPermitPhotoPreview] = useState<string | null>(null);
  const permitPhotoInputRef = useRef<HTMLInputElement>(null);

  // Initialize permit form values when data loads
  useEffect(() => {
    if (permitInfo) {
      setPermitNumber(permitInfo.learnerPermitNumber || "");
      setPermitValidDate(permitInfo.learnerPermitValidDate || "");
      setPermitExpiry(permitInfo.learnerPermitExpiryDate || "");
      setLicenseNumber(permitInfo.driverLicenseNumber || "");
      setLicenseExpiry(permitInfo.licenseExpiryDate || "");
      setPermitPhotoPreview(permitInfo.learnerPermitPhoto || null);
    }
  }, [permitInfo]);

  const uploadDocumentMutation = useMutation({
    mutationFn: async ({ file, docType }: { file: File; docType: string }) => {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      return apiRequest("POST", "/api/student/documents", {
        documentType: docType,
        documentName: file.name,
        documentData: base64,
        mimeType: file.type,
        fileSize: file.size,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/documents"] });
      toast({ title: "Document uploaded", description: "Your document has been uploaded successfully and is pending verification." });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: () => {
      toast({ title: "Upload failed", description: "Failed to upload document. Please try again.", variant: "destructive" });
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (docId: number) => {
      return apiRequest("DELETE", `/api/student/documents/${docId}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/documents"] });
      toast({ title: "Document deleted", description: "The document has been removed." });
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Failed to delete document.", variant: "destructive" });
    },
  });

  // Notification preferences mutation
  const updateNotificationPrefsMutation = useMutation({
    mutationFn: async (updates: Partial<NotificationPreferences>) => {
      return apiRequest("PATCH", "/api/student/notifications/preferences", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/notifications/preferences"] });
      toast({ title: "Preferences updated", description: "Your notification preferences have been saved." });
    },
    onError: () => {
      toast({ title: "Update failed", description: "Failed to update preferences.", variant: "destructive" });
    },
  });

  // Permit info mutation
  const updatePermitMutation = useMutation({
    mutationFn: async (updates: Partial<PermitInfo>) => {
      return apiRequest("PATCH", "/api/student/permit", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/permit"] });
      toast({ title: "Permit info updated", description: "Your permit information has been saved." });
    },
    onError: () => {
      toast({ title: "Update failed", description: "Failed to update permit information.", variant: "destructive" });
    },
  });

  const handlePermitPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Photo must be less than 5MB", variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setPermitPhotoPreview(base64);
      updatePermitMutation.mutate({ learnerPermitPhoto: base64 });
    };
    reader.readAsDataURL(file);
  };

  const handleSavePermit = () => {
    updatePermitMutation.mutate({
      learnerPermitNumber: permitNumber,
      learnerPermitValidDate: permitValidDate,
      learnerPermitExpiryDate: permitExpiry,
      driverLicenseNumber: licenseNumber,
      licenseExpiryDate: licenseExpiry,
    });
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Documents must be less than 10MB", variant: "destructive" });
      return;
    }
    
    setIsUploading(true);
    try {
      await uploadDocumentMutation.mutateAsync({ file, docType: uploadDocType });
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-100 text-red-800"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge className="bg-yellow-100 text-yellow-800"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
    }
  };

  const documentTypeLabels: Record<string, string> = {
    photo_id: "Photo ID",
    permit: "Learner's Permit",
    medical_certificate: "Medical Certificate",
    consent_form: "Consent Form",
    certificate: "Certificate",
    photo: "Photo",
    contract: "Contract",
    other: "Other",
  };

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: profileData || {
      firstName: "",
      lastName: "",
      email: "",
      emailContactType: "preferred",
      phone: "",
      phoneContactType: "preferred",
      homePhone: "",
      homePhoneContactType: "additional",
      primaryLanguage: "English",
      address: "",
      city: "",
      postalCode: "",
      province: "Quebec",
      emergencyContact: "",
      emergencyPhone: "",
      specialNeeds: "",
      accommodations: "",
    },
  });

  // Update form when profile data loads
  useEffect(() => {
    if (profileData) {
      form.reset(profileData);
      if (profileData.profilePhoto) {
        setPhotoPreview(profileData.profilePhoto);
      }
    }
  }, [profileData, form]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: ProfileFormData & { profilePhoto?: string | null }) => {
      return apiRequest("POST", "/api/student/profile", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/me"] });
      toast({
        title: "Profile updated",
        description: "Your profile has been updated successfully!",
        variant: "success",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Profile photo must be less than 5MB",
          variant: "destructive",
        });
        return;
      }
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = (data: ProfileFormData) => {
    updateProfileMutation.mutate({
      ...data,
      profilePhoto: photoPreview,
    });
  };

  // Redirect if not authenticated
  if (!authLoading && !isAuthenticated) {
    setLocation("/student-login");
    return null;
  }

  // Loading state
  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <Skeleton className="h-12 w-64 mb-8" />
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-48 mb-2" />
              <Skeleton className="h-4 w-96" />
            </CardHeader>
            <CardContent className="space-y-6">
              <Skeleton className="h-32 w-32 rounded-full mx-auto" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const studentData = profileData || student;
  const initials = studentData ? `${studentData.firstName?.[0] || ''}${studentData.lastName?.[0] || ''}` : 'ST';

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-lg shadow-lg border-b border-[#ECC462]/20">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center gap-4">
            <Link href="/student/classes">
              <Button variant="ghost" size="sm" className="text-[#111111] hover:!text-[#ECC462] hover:bg-transparent">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-[#111111] to-amber-900 bg-clip-text text-transparent">
                My Profile
              </h1>
              <p className="text-gray-600 mt-1">
                Manage your personal information and contact details
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Card className="bg-white/95 backdrop-blur-sm shadow-xl border-0">
          <CardHeader>
            <CardTitle className="text-2xl text-[#111111]">Personal Information</CardTitle>
            <CardDescription>
              Keep your profile up to date so we can reach you and provide the best service
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                {/* Profile Photo */}
                <div className="flex flex-col items-center gap-4">
                  <Avatar className="h-32 w-32 border-4 border-[#ECC462]">
                    <AvatarImage src={photoPreview || studentData?.profilePhoto || undefined} />
                    <AvatarFallback className="bg-gradient-to-br from-[#ECC462] to-amber-500 text-[#111111] text-3xl font-bold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col items-center gap-2">
                    <label htmlFor="photo-upload" className="cursor-pointer">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-[#ECC462] text-[#111111] hover:bg-[#ECC462]/10"
                        onClick={() => document.getElementById('photo-upload')?.click()}
                        data-testid="button-upload-photo"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Photo
                      </Button>
                    </label>
                    <input
                      id="photo-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePhotoChange}
                    />
                    <p className="text-xs text-gray-500">Max file size: 5MB</p>
                  </div>
                </div>

                {/* Basic Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-700 font-medium flex items-center gap-2">
                          <User className="h-4 w-4" />
                          First Name
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                            data-testid="input-first-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-700 font-medium flex items-center gap-2">
                          <User className="h-4 w-4" />
                          Last Name
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                            data-testid="input-last-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Contact Information */}
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-[#111111] flex items-center gap-2">
                    <Phone className="h-5 w-5 text-[#ECC462]" />
                    Contact Information
                  </h3>

                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-gray-700 font-medium flex items-center gap-2">
                              <Mail className="h-4 w-4" />
                              Email Address
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="email"
                                className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                                data-testid="input-email"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="emailContactType"
                        render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="w-[200px] border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]">
                                  <SelectValue placeholder="Contact type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {contactTypeOptions.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-gray-700 font-medium flex items-center gap-2">
                              <Phone className="h-4 w-4" />
                              Mobile Phone
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="tel"
                                placeholder="(514) 555-0100"
                                className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                                data-testid="input-phone"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="phoneContactType"
                        render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="w-[200px] border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]">
                                  <SelectValue placeholder="Contact type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {contactTypeOptions.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                      <FormField
                        control={form.control}
                        name="homePhone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-gray-700 font-medium">
                              Home Phone (Optional)
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ""}
                                type="tel"
                                placeholder="(514) 555-0100"
                                className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                                data-testid="input-home-phone"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="homePhoneContactType"
                        render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="w-[200px] border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]">
                                  <SelectValue placeholder="Contact type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {contactTypeOptions.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="primaryLanguage"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-gray-700 font-medium flex items-center gap-2">
                            <Globe className="h-4 w-4" />
                            Preferred Language
                          </FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]" data-testid="select-language">
                                <SelectValue placeholder="Select language" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="English">English</SelectItem>
                              <SelectItem value="French">Français</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Address Information */}
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-[#111111] flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-[#ECC462]" />
                    Address
                  </h3>

                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-700 font-medium">
                          Street Address
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="123 Main Street"
                            className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                            data-testid="input-address"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-gray-700 font-medium">
                            City
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ""}
                              placeholder="Montreal"
                              className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                              data-testid="input-city"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="province"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-gray-700 font-medium">
                            Province
                          </FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value || "Quebec"}
                          >
                            <FormControl>
                              <SelectTrigger className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]" data-testid="select-province">
                                <SelectValue placeholder="Select province" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Quebec">Quebec</SelectItem>
                              <SelectItem value="Ontario">Ontario</SelectItem>
                              <SelectItem value="British Columbia">British Columbia</SelectItem>
                              <SelectItem value="Alberta">Alberta</SelectItem>
                              <SelectItem value="Manitoba">Manitoba</SelectItem>
                              <SelectItem value="Saskatchewan">Saskatchewan</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="postalCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-gray-700 font-medium">
                            Postal Code
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ""}
                              placeholder="H1A 1A1"
                              className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                              data-testid="input-postal-code"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Emergency Contact */}
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-[#111111] flex items-center gap-2">
                    <Users className="h-5 w-5 text-[#ECC462]" />
                    Emergency Contact
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="emergencyContact"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-gray-700 font-medium">
                            Contact Name
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="John Doe"
                              className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                              data-testid="input-emergency-contact"
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
                          <FormLabel className="text-gray-700 font-medium">
                            Contact Phone
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="tel"
                              placeholder="(514) 555-0100"
                              className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                              data-testid="input-emergency-phone"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Special Accommodations */}
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-[#111111] flex items-center gap-2">
                    <Heart className="h-5 w-5 text-[#ECC462]" />
                    Special Accommodations
                  </h3>

                  <FormField
                    control={form.control}
                    name="specialNeeds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-700 font-medium">
                          Special Needs
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            value={field.value || ""}
                            placeholder="Describe any special needs or disabilities..."
                            className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462] resize-none"
                            rows={3}
                            data-testid="textarea-special-needs"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="accommodations"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-700 font-medium">
                          Required Accommodations
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            value={field.value || ""}
                            placeholder="Describe any accommodations required for learning or testing..."
                            className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462] resize-none"
                            rows={3}
                            data-testid="textarea-accommodations"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Submit Button */}
                <div className="flex justify-end gap-4 pt-6 border-t border-gray-200">
                  <Link href="/student/classes">
                    <Button
                      type="button"
                      variant="outline"
                      className="border-gray-300"
                      data-testid="button-cancel"
                    >
                      Cancel
                    </Button>
                  </Link>
                  <Button
                    type="submit"
                    className="bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg"
                    disabled={updateProfileMutation.isPending}
                    data-testid="button-save-profile"
                  >
                    {updateProfileMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="mr-2 h-5 w-5" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Learner's Permit Section */}
        <Card className="mt-8 border-0 shadow-xl bg-white/90 backdrop-blur-sm">
          <CardHeader className="bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-100">
            <CardTitle className="text-xl font-semibold text-[#111111] flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-[#ECC462]" />
              Learner's Permit
            </CardTitle>
            <CardDescription>
              Manage your learner's permit information and upload a photo of your permit
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {permitInfoLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Permit Number (Nom de Dossier)</label>
                    <Input
                      value={permitNumber}
                      onChange={(e) => setPermitNumber(e.target.value)}
                      placeholder="Enter your permit number"
                      className="border-gray-200 focus:border-[#ECC462]"
                      data-testid="input-permit-number"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Permit Valid From</label>
                    <Input
                      type="date"
                      value={permitValidDate}
                      onChange={(e) => setPermitValidDate(e.target.value)}
                      className="border-gray-200 focus:border-[#ECC462]"
                      data-testid="input-permit-valid-date"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Permit Expiry Date</label>
                    <Input
                      type="date"
                      value={permitExpiry}
                      onChange={(e) => setPermitExpiry(e.target.value)}
                      className="border-gray-200 focus:border-[#ECC462]"
                      data-testid="input-permit-expiry"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Driver's License Number (if any)</label>
                    <Input
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      placeholder="Enter license number"
                      className="border-gray-200 focus:border-[#ECC462]"
                      data-testid="input-license-number"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">License Expiry Date</label>
                    <Input
                      type="date"
                      value={licenseExpiry}
                      onChange={(e) => setLicenseExpiry(e.target.value)}
                      className="border-gray-200 focus:border-[#ECC462]"
                      data-testid="input-license-expiry"
                    />
                  </div>
                </div>

                {/* Permit Photo Upload */}
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <label className="text-sm font-medium text-gray-700 mb-3 block">Permit Photo</label>
                  <div className="flex items-start gap-4">
                    {permitPhotoPreview ? (
                      <div className="relative">
                        <img 
                          src={permitPhotoPreview} 
                          alt="Permit" 
                          className="w-40 h-28 object-cover rounded-lg border border-gray-300"
                          data-testid="img-permit-photo"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute -top-2 -right-2 h-6 w-6 p-0 bg-white rounded-full shadow-md hover:bg-red-50"
                          onClick={() => {
                            setPermitPhotoPreview(null);
                            updatePermitMutation.mutate({ learnerPermitPhoto: "" });
                          }}
                          data-testid="button-remove-permit-photo"
                        >
                          <XCircle className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    ) : (
                      <div className="w-40 h-28 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-white">
                        <Image className="h-8 w-8 text-gray-400" />
                      </div>
                    )}
                    <div className="flex-1">
                      <input
                        ref={permitPhotoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handlePermitPhotoUpload}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => permitPhotoInputRef.current?.click()}
                        disabled={updatePermitMutation.isPending}
                        className="mb-2"
                        data-testid="button-upload-permit-photo"
                      >
                        {updatePermitMutation.isPending ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading...</>
                        ) : (
                          <><Upload className="mr-2 h-4 w-4" />Upload Photo</>
                        )}
                      </Button>
                      <p className="text-xs text-gray-500">Upload a clear photo of your learner's permit (max 5MB)</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSavePermit}
                    disabled={updatePermitMutation.isPending}
                    className="bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium"
                    data-testid="button-save-permit"
                  >
                    {updatePermitMutation.isPending ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                    ) : (
                      <><CheckCircle2 className="mr-2 h-4 w-4" />Save Permit Info</>
                    )}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
