import { useState, useEffect, useCallback } from "react";
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
import { Loader2, User, MapPin, FileText, Phone, Car, Upload, CheckCircle, ChevronRight, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

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

const step3Schema = z.object({
  permitNumber: z.string().optional(),
  permitExpiryDate: z.string().optional(),
  driverLicenseNumber: z.string().optional(),
  licenseExpiryDate: z.string().optional(),
});

const step4Schema = z.object({
  emergencyContact: z.string().min(1, "Emergency contact name is required"),
  emergencyPhone: z.string().min(10, "Emergency phone is required"),
});

const step5Schema = z.object({
  courseType: z.string().min(1, "Please select a course type"),
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
  permitExpiryDate?: string;
  driverLicenseNumber?: string;
  licenseExpiryDate?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  courseType?: string;
};

const TOTAL_STEPS = 5;

export default function StudentOnboarding() {
  const [, params] = useRoute("/student/onboarding/:registrationId");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const registrationId = params?.registrationId ? parseInt(params.registrationId) : null;
  
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<OnboardingData>({});
  const [uploadedDocuments, setUploadedDocuments] = useState<{ type: string; name: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const { data: registration, isLoading } = useQuery({
    queryKey: ["/api/student/onboarding", registrationId],
    queryFn: async () => {
      const res = await fetch(`/api/student/onboarding/${registrationId}`);
      if (!res.ok) throw new Error("Failed to load registration");
      return res.json();
    },
    enabled: !!registrationId,
  });

  useEffect(() => {
    if (registration) {
      if (!registration.emailVerified) {
        setLocation("/student/signup");
        return;
      }
      if (registration.onboardingCompleted) {
        setLocation("/student/login");
        return;
      }
      setCurrentStep(registration.onboardingStep || 1);
      setFormData(registration.onboardingData || {});
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

  const step3Form = useForm({
    resolver: zodResolver(step3Schema),
    defaultValues: {
      permitNumber: formData.permitNumber || "",
      permitExpiryDate: formData.permitExpiryDate || "",
      driverLicenseNumber: formData.driverLicenseNumber || "",
      licenseExpiryDate: formData.licenseExpiryDate || "",
    },
  });

  const step4Form = useForm({
    resolver: zodResolver(step4Schema),
    defaultValues: {
      emergencyContact: formData.emergencyContact || "",
      emergencyPhone: formData.emergencyPhone || "",
    },
  });

  const step5Form = useForm({
    resolver: zodResolver(step5Schema),
    defaultValues: {
      courseType: formData.courseType || "",
    },
  });

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
      step3Form.reset({
        permitNumber: formData.permitNumber || "",
        permitExpiryDate: formData.permitExpiryDate || "",
        driverLicenseNumber: formData.driverLicenseNumber || "",
        licenseExpiryDate: formData.licenseExpiryDate || "",
      });
      step4Form.reset({
        emergencyContact: formData.emergencyContact || "",
        emergencyPhone: formData.emergencyPhone || "",
      });
      step5Form.reset({
        courseType: formData.courseType || "",
      });
    }
  }, [formData]);

  const saveMutation = useMutation({
    mutationFn: async ({ step, data }: { step: number; data: any }) => {
      return await apiRequest("PATCH", `/api/student/onboarding/${registrationId}`, { step, data });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/student/complete-onboarding/${registrationId}`, {});
    },
    onSuccess: () => {
      toast({
        title: "Welcome to Morty's Driving School!",
        description: "Your account is ready. You can now log in and book classes.",
      });
      setLocation("/student/login");
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
    const finalData = { ...formData, ...stepData };
    setFormData(finalData);
    
    try {
      await saveMutation.mutateAsync({ step: TOTAL_STEPS, data: stepData });
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
        });
        
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

  const stepIcons = [User, MapPin, FileText, Phone, Car];
  const stepTitles = ["Personal Info", "Address", "Permit Details", "Emergency Contact", "Course Selection"];

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
              {currentStep === 3 && "Your permit and license information (if applicable)"}
              {currentStep === 4 && "Who should we contact in case of emergency?"}
              {currentStep === 5 && "Choose your driving course"}
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
              <Form {...step3Form}>
                <form onSubmit={step3Form.handleSubmit(handleNext)} className="space-y-4">
                  <div className="p-4 bg-amber-50 rounded-lg mb-4">
                    <p className="text-sm text-amber-800">
                      If you already have a learner's permit, please enter the details below. You can also upload a photo of your permit.
                    </p>
                  </div>
                  <FormField
                    control={step3Form.control}
                    name="permitNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Permit Number / Nom de Dossier</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Enter your permit number" data-testid="input-permit-number" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={step3Form.control}
                    name="permitExpiryDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Permit Expiry Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" data-testid="input-permit-expiry" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={step3Form.control}
                    name="driverLicenseNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Driver's License Number (if any)</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-license-number" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={step3Form.control}
                    name="licenseExpiryDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Expiry Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" data-testid="input-license-expiry" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center">
                    <Upload className="mx-auto h-10 w-10 text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600 mb-2">Upload a photo of your permit (optional)</p>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleFileUpload(e, "permit_photo")}
                      className="hidden"
                      id="permit-upload"
                      data-testid="input-permit-upload"
                    />
                    <label htmlFor="permit-upload">
                      <Button type="button" variant="outline" asChild disabled={isUploading}>
                        <span className="cursor-pointer">
                          {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                          Choose File
                        </span>
                      </Button>
                    </label>
                    {uploadedDocuments.filter(d => d.type === "permit_photo").map((doc, i) => (
                      <p key={i} className="text-sm text-green-600 mt-2">
                        <CheckCircle className="inline h-4 w-4 mr-1" /> {doc.name}
                      </p>
                    ))}
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

            {currentStep === 5 && (
              <Form {...step5Form}>
                <form onSubmit={step5Form.handleSubmit(handleComplete)} className="space-y-4">
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
                                <span>Automobile (Class 5)</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="moto">
                              <div className="flex items-center gap-2">
                                <span>🏍️</span>
                                <span>Motorcycle (Class 6)</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="scooter">
                              <div className="flex items-center gap-2">
                                <span>🛵</span>
                                <span>Scooter (Class 6D)</span>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

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
