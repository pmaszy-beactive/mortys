import { useState, useEffect, useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Loader2, User, MapPin, Phone, Car, Bike, Upload, CheckCircle, ChevronRight, ChevronLeft, Video, Users, CalendarDays, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const step1Schema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(10, "Please enter a valid phone number"),
  homePhone: z.string().optional(),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  primaryLanguage: z.string().default("English"),
});

const step2Schema = z.object({
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  postalCode: z.string().min(1, "Postal code is required"),
  province: z.string().default("Quebec"),
  country: z.string().default("Canada"),
});

const step4Schema = z.object({
  emergencyContact: z.string().min(1, "Emergency contact name is required"),
  emergencyPhone: z.string().min(10, "Emergency phone is required"),
  permitNumber: z.string().trim().min(1, "Permit number is required"),
  referenceNumber: z.string().optional(),
});

const step5Schema = z.object({
  courseType: z.string().optional(),
  referralSource: z.string().optional(),
  referralDetail: z.string().optional(),
  selectedStartDateId: z.string().optional(),
  parentFirstName: z.string().optional(),
  parentLastName: z.string().optional(),
  parentEmail: z.string().email("Please enter a valid email").optional().or(z.literal("")),
  parentPhone: z.string().optional(),
  parentRelationship: z.string().optional(),
  parentPermissionLevel: z.string().optional(),
});

type OnboardingData = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  homePhone?: string;
  dateOfBirth?: string;
  primaryLanguage?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  province?: string;
  country?: string;
  permitNumber?: string;
  learnerPermitNumber?: string;
  permitExpiryDate?: string;
  referenceNumber?: string;
  driverLicenseNumber?: string;
  licenseExpiryDate?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  courseType?: string;
  referralSource?: string;
  referralDetail?: string;
  selectedStartDateId?: number | string;
  parentFirstName?: string;
  parentLastName?: string;
  parentEmail?: string;
  parentPhone?: string;
  parentRelationship?: string;
  parentPermissionLevel?: string;
};

type CourseStartDate = {
  id: number;
  courseType: string;
  startDate: string;
  startTime?: string | null;
  status: string;
};

const TOTAL_STEPS = 4;

export default function StudentOnboarding() {
  const [, params] = useRoute("/student/onboarding/:registrationId");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const registrationId = params?.registrationId ? parseInt(params.registrationId) : null;
  const registrationToken = registrationId
    ? sessionStorage.getItem(`student_registration_token:${registrationId}`)
    : null;
  
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<OnboardingData>({});
  const [uploadedDocuments, setUploadedDocuments] = useState<{ type: string; name: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showParentFields, setShowParentFields] = useState(false);
  const [showAllStartDates, setShowAllStartDates] = useState(false);

  const { data: registration, isLoading, error: registrationError } = useQuery({
    queryKey: ["/api/student/onboarding", registrationId],
    queryFn: async () => {
      const res = await fetch(`/api/student/onboarding/${registrationId}`, {
        headers: { "X-Registration-Token": registrationToken! },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || "Failed to load registration");
      return res.json();
    },
    enabled: !!registrationId && !!registrationToken,
  });

  useEffect(() => {
    if (!registrationId || !registrationToken || registrationError) {
      toast({
        title: "Please verify your email",
        description: registrationError instanceof Error ? registrationError.message : "Your secure registration session is missing.",
        variant: "destructive",
      });
      setLocation("/student/register");
    }
  }, [registrationId, registrationToken, registrationError, setLocation, toast]);

  // Step/form data initialize only on first load so a background refetch
  // doesn't yank the student back a step or wipe in-progress typing.
  const onboardingInitializedRef = useRef(false);
  useEffect(() => {
    if (registration) {
      if (!registration.emailVerified) {
        setLocation("/student/register");
        return;
      }
      if (!registration.passwordSet) {
        setLocation("/student/register");
        return;
      }
      if (registration.onboardingCompleted) {
        setLocation("/student/login");
        return;
      }
      if (!onboardingInitializedRef.current) {
        onboardingInitializedRef.current = true;
        setCurrentStep(registration.onboardingStep || 1);
        setFormData(registration.onboardingData || {});
      }
    }
  }, [registration, setLocation]);

  const step1Form = useForm({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      firstName: formData.firstName || "",
      lastName: formData.lastName || "",
      phone: formData.phone || "",
      homePhone: formData.homePhone || "",
      dateOfBirth: formData.dateOfBirth || "",
      primaryLanguage: formData.primaryLanguage || "English",
    },
  });

  const step2Form = useForm({
    resolver: zodResolver(step2Schema),
    defaultValues: {
      address: formData.address || "",
      city: formData.city || "",
      postalCode: formData.postalCode || "",
      province: formData.province || "Quebec",
      country: formData.country || "Canada",
    },
  });

  const step4Form = useForm({
    resolver: zodResolver(step4Schema),
    defaultValues: {
      emergencyContact: formData.emergencyContact || "",
      emergencyPhone: formData.emergencyPhone || "",
      permitNumber: formData.permitNumber || formData.learnerPermitNumber || "",
      referenceNumber: formData.referenceNumber ?? formData.driverLicenseNumber ?? "",
    },
  });

  const step5Form = useForm({
    resolver: zodResolver(step5Schema),
    defaultValues: {
      courseType: formData.courseType || "",
      referralSource: formData.referralSource || "",
      referralDetail: formData.referralDetail || "",
      selectedStartDateId: formData.selectedStartDateId ? String(formData.selectedStartDateId) : "",
      parentFirstName: formData.parentFirstName || "",
      parentLastName: formData.parentLastName || "",
      parentEmail: formData.parentEmail || "",
      parentPhone: formData.parentPhone || "",
      parentRelationship: formData.parentRelationship || "",
      parentPermissionLevel: formData.parentPermissionLevel || "view_only",
    },
  });

  const selectedCourseType = step5Form.watch("courseType");
  const selectedReferralSource = step5Form.watch("referralSource");

  const { data: startDates = [], isLoading: isStartDatesLoading } = useQuery<CourseStartDate[]>({
    queryKey: ["/api/course-start-dates", selectedCourseType],
    queryFn: async () => {
      const url = selectedCourseType
        ? `/api/course-start-dates?courseType=${encodeURIComponent(selectedCourseType)}`
        : "/api/course-start-dates";
      const res = await fetch(url);
      if (!res.ok) return [];
      return res.json();
    },
  });

  useEffect(() => {
    setShowAllStartDates(false);
  }, [selectedCourseType]);

  useEffect(() => {
    if (formData) {
      step1Form.reset({
        firstName: formData.firstName || "",
        lastName: formData.lastName || "",
        phone: formData.phone || "",
        homePhone: formData.homePhone || "",
        dateOfBirth: formData.dateOfBirth || "",
        primaryLanguage: formData.primaryLanguage || "English",
      });
      step2Form.reset({
        address: formData.address || "",
        city: formData.city || "",
        postalCode: formData.postalCode || "",
        province: formData.province || "Quebec",
        country: formData.country || "Canada",
      });
      step4Form.reset({
        emergencyContact: formData.emergencyContact || "",
        emergencyPhone: formData.emergencyPhone || "",
        permitNumber: formData.permitNumber || formData.learnerPermitNumber || "",
        referenceNumber: formData.referenceNumber ?? formData.driverLicenseNumber ?? "",
      });
      step5Form.reset({
        courseType: formData.courseType || "",
        referralSource: formData.referralSource || "",
        referralDetail: formData.referralDetail || "",
        selectedStartDateId: formData.selectedStartDateId ? String(formData.selectedStartDateId) : "",
        parentFirstName: formData.parentFirstName || "",
        parentLastName: formData.parentLastName || "",
        parentEmail: formData.parentEmail || "",
        parentPhone: formData.parentPhone || "",
        parentRelationship: formData.parentRelationship || "",
        parentPermissionLevel: formData.parentPermissionLevel || "view_only",
      });
      if (formData.parentEmail) setShowParentFields(true);
    }
  }, [formData]);

  const saveMutation = useMutation({
    mutationFn: async ({ step, data }: { step: number; data: any }) => {
      return await apiRequest("PATCH", `/api/student/onboarding/${registrationId}`, { step, data }, {
        "X-Registration-Token": registrationToken!,
      });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/student/complete-onboarding/${registrationId}`, {}, {
        "X-Registration-Token": registrationToken!,
      });
    },
    onSuccess: (response) => {
      localStorage.setItem("student_auth_token", response.token);
      queryClient.setQueryData(["/api/student/me"], response.student);
      queryClient.invalidateQueries({ queryKey: ["/api/student/me"] });
      sessionStorage.removeItem(`student_registration_token:${registrationId}`);
      toast({
        title: "Profile complete!",
        description: "Welcome! Your account is ready.",
      });
      setLocation("/student/dashboard");
    },
    onError: (error: any) => {
      toast({
        title: "Registration failed",
        description: error.message || "Please check all required fields.",
        variant: "destructive",
      });
    },
  });

  const handleNext = async (stepData: any) => {
    const newFormData = { ...formData, ...stepData };
    setFormData(newFormData);
    
    const nextStep = currentStep + 1;
    
    try {
      await saveMutation.mutateAsync({ step: nextStep, data: stepData });
      
      if (currentStep < TOTAL_STEPS) {
        setCurrentStep(nextStep);
      }
    } catch (error) {
      console.error("Failed to save step:", error);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async (stepData: any) => {
    const cleaned: any = { ...stepData };
    if (cleaned.selectedStartDateId) {
      cleaned.selectedStartDateId = parseInt(cleaned.selectedStartDateId);
    } else {
      delete cleaned.selectedStartDateId;
    }
    // Drop empty parent fields so we only link a guardian when details were provided.
    if (!cleaned.parentEmail || !cleaned.parentFirstName || !cleaned.parentLastName) {
      delete cleaned.parentFirstName;
      delete cleaned.parentLastName;
      delete cleaned.parentEmail;
      delete cleaned.parentPhone;
      delete cleaned.parentRelationship;
      delete cleaned.parentPermissionLevel;
    }
    const finalData = { ...formData, ...cleaned };
    setFormData(finalData);
    
    try {
      await saveMutation.mutateAsync({ step: TOTAL_STEPS, data: cleaned });
      await completeMutation.mutateAsync();
    } catch (error) {
      console.error("Failed to complete:", error);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, documentType: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsUploading(true);
    
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        
        await apiRequest("POST", `/api/student/upload-document/${registrationId}`, {
          documentType,
          documentName: file.name,
          documentData: base64Data,
          mimeType: file.type,
          fileSize: file.size,
        }, { "X-Registration-Token": registrationToken! });
        
        setUploadedDocuments([...uploadedDocuments, { type: documentType, name: file.name }]);
        toast({
          title: "Document uploaded",
          description: `${file.name} has been uploaded successfully.`,
        });
      };
      reader.readAsDataURL(file);
    } catch (error) {
      toast({
        title: "Upload failed",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50">
        <Loader2 className="h-8 w-8 animate-spin text-[#ECC462]" />
      </div>
    );
  }

  const stepIcons = [User, MapPin, Phone, Car];
  const stepTitles = ["Personal Info", "Address", "Emergency Contact", "Course Selection"];

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#111111] mb-2">Complete Your Profile</h1>
          <p className="text-amber-900">Step {currentStep} of {TOTAL_STEPS}</p>
        </div>

        <div className="flex justify-center mb-8">
          {stepIcons.map((Icon, index) => (
            <div key={index} className="flex items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                index + 1 < currentStep ? "bg-green-500 text-white" :
                index + 1 === currentStep ? "bg-[#ECC462] text-[#111111]" :
                "bg-gray-200 text-gray-500"
              }`}>
                {index + 1 < currentStep ? <CheckCircle className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
              </div>
              {index < stepIcons.length - 1 && (
                <div className={`w-12 h-1 ${index + 1 < currentStep ? "bg-green-500" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>

        <Progress value={(currentStep / TOTAL_STEPS) * 100} className="mb-8 h-2" />

        <Card className="shadow-xl border-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {(() => { const Icon = stepIcons[currentStep - 1]; return <Icon className="h-6 w-6 text-[#ECC462]" />; })()}
              {stepTitles[currentStep - 1]}
            </CardTitle>
            <CardDescription>
              {currentStep === 1 && "Tell us about yourself"}
              {currentStep === 2 && "Where should we send correspondence?"}
              {currentStep === 3 && "Who should we contact in case of emergency?"}
              {currentStep === 4 && "Choose your driving course"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {currentStep === 1 && (
              <Form {...step1Form}>
                <form onSubmit={step1Form.handleSubmit(handleNext)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={step1Form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First Name *</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-first-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={step1Form.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Last Name *</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-last-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={step1Form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mobile Phone *</FormLabel>
                        <FormControl>
                          <Input {...field} type="tel" placeholder="(514) 555-0123" data-testid="input-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={step1Form.control}
                    name="homePhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Home Phone (Optional)</FormLabel>
                        <FormControl>
                          <Input {...field} type="tel" data-testid="input-home-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={step1Form.control}
                    name="dateOfBirth"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date of Birth *</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" data-testid="input-dob" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={step1Form.control}
                    name="primaryLanguage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Primary Language</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-language">
                              <SelectValue placeholder="Select language" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="English">English</SelectItem>
                            <SelectItem value="French">French</SelectItem>
                            <SelectItem value="Spanish">Spanish</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end pt-4">
                    <Button type="submit" className="bg-[#ECC462] hover:bg-[#d4b058] text-[#111111]" data-testid="button-next">
                      Next <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </form>
              </Form>
            )}

            {currentStep === 2 && (
              <Form {...step2Form}>
                <form onSubmit={step2Form.handleSubmit(handleNext)} className="space-y-4">
                  <FormField
                    control={step2Form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Street Address *</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="123 Main Street, Apt 4" data-testid="input-address" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={step2Form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City *</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Montreal" data-testid="input-city" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={step2Form.control}
                      name="postalCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Postal Code *</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="H1A 1A1" data-testid="input-postal" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={step2Form.control}
                      name="province"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Province</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-province">
                                <SelectValue placeholder="Select province" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Quebec">Quebec</SelectItem>
                              <SelectItem value="Ontario">Ontario</SelectItem>
                              <SelectItem value="British Columbia">British Columbia</SelectItem>
                              <SelectItem value="Alberta">Alberta</SelectItem>
                              <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={step2Form.control}
                      name="country"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Country</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-country" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex justify-between pt-4">
                    <Button type="button" variant="outline" onClick={handleBack} data-testid="button-back">
                      <ChevronLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    <Button type="submit" className="bg-[#ECC462] hover:bg-[#d4b058] text-[#111111]" data-testid="button-next">
                      Next <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </form>
              </Form>
            )}

            {currentStep === 3 && (
              <Form {...step4Form}>
                <form onSubmit={step4Form.handleSubmit(handleNext)} className="space-y-4">
                  <div className="p-4 bg-amber-50 rounded-lg mb-4">
                    <p className="text-sm text-amber-800">
                      Please provide an emergency contact who can be reached in case of an emergency during your driving lessons.
                    </p>
                  </div>
                  <FormField
                    control={step4Form.control}
                    name="emergencyContact"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Contact Name *</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Full name" data-testid="input-emergency-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={step4Form.control}
                    name="emergencyPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Contact Phone *</FormLabel>
                        <FormControl>
                          <Input {...field} type="tel" placeholder="(514) 555-0123" data-testid="input-emergency-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="border-t pt-4 mt-4 space-y-4">
                    <p className="text-sm text-gray-600">
                      Enter the permit identifier issued for your application. A reference number is optional because not all motorcycle, scooter, or automobile applicants have one.
                    </p>
                    <FormField
                      control={step4Form.control}
                      name="permitNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Permit Number *</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Enter your permit number" data-testid="input-permit-number" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={step4Form.control}
                      name="referenceNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Reference Number (Optional)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Enter a reference number, if you have one" data-testid="input-reference-number" />
                          </FormControl>
                          <p className="text-xs text-gray-500">Optional — not all applicants are issued a reference number.</p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex justify-between pt-4">
                    <Button type="button" variant="outline" onClick={handleBack} data-testid="button-back">
                      <ChevronLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    <Button type="submit" className="bg-[#ECC462] hover:bg-[#d4b058] text-[#111111]" data-testid="button-next">
                      Next <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </form>
              </Form>
            )}

            {currentStep === 4 && (
              <Form {...step5Form}>
                <form onSubmit={step5Form.handleSubmit(handleComplete)} className="space-y-4">
                  {/* Show locked summary when course was selected before account creation */}
                  {formData.courseType ? (
                    <div className="p-4 bg-[#111111] rounded-xl flex items-center gap-3">
                      {formData.courseType === "auto" ? (
                        <Car className="h-7 w-7 flex-shrink-0 text-[#ECC462]" aria-hidden="true" />
                      ) : (
                        <Bike className="h-7 w-7 flex-shrink-0 text-[#ECC462]" aria-hidden="true" />
                      )}
                      <div>
                        <div className="text-xs text-[#ECC462] font-medium uppercase tracking-wide">Your selected course</div>
                        <div className="text-sm text-white font-semibold">
                          {formData.courseType === "auto"
                            ? "Automobile (Licence Class 5)"
                            : formData.courseType === "moto"
                            ? "Motorcycle (Licence Class 6)"
                            : "Scooter (Licence Class 6D)"}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">Selected during registration</div>
                      </div>
                    </div>
                  ) : (
                    <FormField
                      control={step5Form.control}
                      name="courseType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Select Your Course *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-course">
                                <SelectValue placeholder="Choose a course type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="auto">
                                <div className="flex items-center gap-2">
                                  <Car className="h-4 w-4" />
                                  <span>Automobile (Licence Class 5)</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="moto">
                                <div className="flex items-center gap-2">
                                  <Bike className="h-4 w-4" />
                                  <span>Motorcycle (Licence Class 6)</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="scooter">
                                <div className="flex items-center gap-2">
                                  <Bike className="h-4 w-4" />
                                  <span>Scooter (Licence Class 6D)</span>
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 flex gap-2">
                    <Video className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-800">
                      <strong>Theory Classes are held online via Zoom.</strong> You'll receive a Zoom link for each theory session.
                      Driving Classes (in the car) take place in person with your instructor.
                    </p>
                  </div>

                  <FormField
                    control={step5Form.control}
                    name="selectedStartDateId"
                    rules={{
                      validate: (value) => startDates.length === 0 || !!value || "Please select a Module 1 start date",
                    }}
                    render={({ field }) => {
                      const selectedDateIsLater = startDates.findIndex((date) => String(date.id) === field.value) >= 5;
                      const shouldShowAllStartDates = showAllStartDates || selectedDateIsLater;
                      const visibleStartDates = shouldShowAllStartDates ? startDates : startDates.slice(0, 5);
                      const hasLaterDates = startDates.length > 5;
                      const formatDate = (date: CourseStartDate) =>
                        new Date(`${date.startDate}T12:00:00`).toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        });
                      const formatMonth = (date: CourseStartDate) =>
                        new Date(`${date.startDate}T12:00:00`).toLocaleDateString(undefined, {
                          month: "long",
                          year: "numeric",
                        });

                      return (
                        <FormItem className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#111111] text-[#ECC462]">
                              <CalendarDays className="h-5 w-5" aria-hidden="true" />
                            </div>
                            <div>
                              <FormLabel className="text-base font-semibold text-[#111111]">Choose your Module 1 start date</FormLabel>
                              <p className="mt-0.5 text-sm text-amber-900">Select an available class date to reserve your place.</p>
                            </div>
                          </div>

                          {isStartDatesLoading ? (
                            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Loading available dates">
                              {[0, 1, 2, 3].map((index) => (
                                <div key={index} className="h-[76px] animate-pulse rounded-lg bg-amber-100" />
                              ))}
                            </div>
                          ) : startDates.length === 0 ? (
                            <div className="mt-4 rounded-lg border border-dashed border-amber-300 bg-white/70 px-4 py-5 text-sm text-amber-900">
                              There are no available start dates for this course right now. Please check back soon or contact Morty&apos;s Driving School for help.
                            </div>
                          ) : (
                            <>
                              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Available Module 1 start dates">
                                {visibleStartDates.map((date, index) => {
                                  const isSelected = field.value === String(date.id);
                                  const isInitialOption = index < 5;
                                  return (
                                    <button
                                      key={date.id}
                                      type="button"
                                      role="radio"
                                      aria-checked={isSelected}
                                      aria-label={`${formatDate(date)}${date.startTime ? ` at ${date.startTime}` : ""}${isSelected ? ", selected" : ""}`}
                                      onClick={() => field.onChange(String(date.id))}
                                      data-testid={isInitialOption ? `start-date-box-${date.id}` : `later-start-date-box-${date.id}`}
                                      data-status={date.status}
                                      className={`touch-manipulation min-h-[76px] rounded-lg border-2 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 ${
                                        isSelected
                                          ? "border-[#111111] bg-[#111111] text-white"
                                          : "border-amber-200 bg-white text-[#111111] hover:border-[#ECC462] hover:bg-amber-100"
                                      }`}
                                    >
                                      <span className={`block text-xs font-semibold uppercase tracking-[0.14em] ${isSelected ? "text-[#ECC462]" : "text-amber-700"}`}>
                                        {formatMonth(date)}
                                      </span>
                                      <span className="mt-0.5 flex items-center justify-between gap-3">
                                        <span className="font-semibold">{formatDate(date)}</span>
                                        {date.startTime && (
                                          <span className={`inline-flex items-center gap-1 text-xs ${isSelected ? "text-amber-100" : "text-gray-600"}`}>
                                            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                                            {date.startTime}
                                          </span>
                                        )}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                              {hasLaterDates && !shouldShowAllStartDates && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => setShowAllStartDates(true)}
                                  className="mt-3 min-h-11 border-amber-300 bg-white text-[#111111] hover:bg-amber-100"
                                  data-testid="button-choose-another-date"
                                >
                                  Choose another date
                                </Button>
                              )}
                            </>
                          )}
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />

                  <FormField
                    control={step5Form.control}
                    name="referralSource"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>How did you hear about us?</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-referral">
                              <SelectValue placeholder="Select an option" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="google">Google Search</SelectItem>
                            <SelectItem value="social_media">Social Media</SelectItem>
                            <SelectItem value="friend_family">Friend or Family</SelectItem>
                            <SelectItem value="school">School</SelectItem>
                            <SelectItem value="advertisement">Advertisement</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {(selectedReferralSource === "other" || selectedReferralSource === "friend_family" || selectedReferralSource === "social_media") && (
                    <FormField
                      control={step5Form.control}
                      name="referralDetail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Please tell us more (optional)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="e.g., name of the person, platform, etc." data-testid="input-referral-detail" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <div className="border-t pt-4">
                    <button
                      type="button"
                      onClick={() => setShowParentFields((v) => !v)}
                      className="flex items-center gap-2 text-sm font-medium text-[#111111] hover:text-[#ECC462]"
                      data-testid="button-toggle-parent"
                    >
                      <Users className="h-4 w-4" />
                      {showParentFields ? "Remove parent / guardian" : "Add a parent or guardian (optional)"}
                    </button>
                    <p className="text-xs text-gray-500 mt-1">
                      Recommended for students under 18. A parent or guardian can view progress and, if you allow, book classes.
                    </p>
                  </div>

                  {showParentFields && (
                    <div className="space-y-4 p-4 bg-gray-50 rounded-lg border">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={step5Form.control}
                          name="parentFirstName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Parent First Name</FormLabel>
                              <FormControl>
                                <Input {...field} data-testid="input-parent-first-name" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={step5Form.control}
                          name="parentLastName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Parent Last Name</FormLabel>
                              <FormControl>
                                <Input {...field} data-testid="input-parent-last-name" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={step5Form.control}
                        name="parentEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Parent Email</FormLabel>
                            <FormControl>
                              <Input {...field} type="email" placeholder="parent@example.com" data-testid="input-parent-email" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={step5Form.control}
                          name="parentPhone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Parent Phone</FormLabel>
                              <FormControl>
                                <Input {...field} type="tel" data-testid="input-parent-phone" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={step5Form.control}
                          name="parentRelationship"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Relationship</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-parent-relationship">
                                    <SelectValue placeholder="Select" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="Parent">Parent</SelectItem>
                                  <SelectItem value="Guardian">Guardian</SelectItem>
                                  <SelectItem value="Other">Other</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={step5Form.control}
                        name="parentPermissionLevel"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>What can they do?</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-parent-permission">
                                  <SelectValue placeholder="Select access level" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="view_only">View progress only</SelectItem>
                                <SelectItem value="view_book">View & book classes</SelectItem>
                                <SelectItem value="view_book_pay">View, book & make payments</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}

                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <h4 className="font-medium text-green-800 mb-2">You're almost done!</h4>
                    <p className="text-sm text-green-700">
                      After completing registration, you'll be able to log in and start booking your driving classes.
                    </p>
                  </div>

                  <div className="flex justify-between pt-4">
                    <Button type="button" variant="outline" onClick={handleBack} data-testid="button-back">
                      <ChevronLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    <Button
                      type="submit"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      disabled={completeMutation.isPending}
                      data-testid="button-complete"
                    >
                      {completeMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating Account...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Complete Registration
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
