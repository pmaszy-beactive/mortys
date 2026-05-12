import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertStudentSchema, type Student, type Instructor, type Location } from "@shared/schema";
import { z } from "zod";
import { Loader2 } from "lucide-react";

const studentFormSchema = insertStudentSchema.extend({
  firstName: z.string().min(1, "First name is required").min(2, "First name must be at least 2 characters"),
  lastName: z.string().min(1, "Last name is required").min(2, "Last name must be at least 2 characters"),
  email: z.string().min(1, "Email is required").email("Please enter a valid email address"),
  phone: z.string().min(1, "Phone number is required").regex(
    /^[\d\s\-\(\)\+]+$/,
    "Please enter a valid phone number (digits, spaces, dashes, and parentheses only)"
  ).min(10, "Phone number must be at least 10 digits"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  address: z.string().min(1, "Address is required").min(5, "Address must be at least 5 characters"),
  emergencyContact: z.string().min(1, "Emergency contact is required").min(2, "Emergency contact must be at least 2 characters"),
  emergencyPhone: z.string().min(1, "Emergency phone is required").regex(
    /^[\d\s\-\(\)\+]+$/,
    "Please enter a valid phone number (digits, spaces, dashes, and parentheses only)"
  ).min(10, "Emergency phone must be at least 10 digits"),
  courseType: z.string().min(1, "Course type is required"),
  homePhone: z.string().optional().refine((val) => {
    if (!val || val.length === 0) return true;
    return /^[\d\s\-\(\)\+]+$/.test(val) && val.replace(/\D/g, '').length >= 10;
  }, "Please enter a valid phone number (digits, spaces, dashes, and parentheses only)"),
  primaryLanguage: z.string().optional(),
}).partial({
  // Make all the legacy migration fields optional for basic student creation
  city: true,
  postalCode: true,
  province: true,
  country: true,
  favoriteInstructorId: true,
  legacyId: true,
  enrollmentDate: true,
  completionDate: true,
  transferredFrom: true,
  transferredCredits: true,
  totalHoursCompleted: true,
  totalHoursRequired: true,
  theoryHoursCompleted: true,
  practicalHoursCompleted: true,
  totalAmountDue: true,
  amountPaid: true,
  paymentPlan: true,
  lastPaymentDate: true,
  governmentId: true,
  driverLicenseNumber: true,
  licenseExpiryDate: true,
  medicalCertificate: true,
  visionTest: true,
  profilePhoto: true,
  digitalSignature: true,
  signatureConsent: true,
  testScores: true,
  finalExamScore: true,
  roadTestDate: true,
  roadTestResult: true,
  specialNeeds: true,
  accommodations: true,
  languagePreference: true,
});

type StudentFormData = z.infer<typeof studentFormSchema>;

interface StudentFormProps {
  student?: Student;
  onSuccess: () => void;
}

export default function StudentForm({ student, onSuccess }: StudentFormProps) {
  const { toast } = useToast();
  const isEditing = !!student;

  const { data: instructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const form = useForm<StudentFormData>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: {
      firstName: student?.firstName || "",
      lastName: student?.lastName || "",
      email: student?.email || "",
      phone: student?.phone || "",
      homePhone: student?.homePhone || "",
      primaryLanguage: student?.primaryLanguage || "English",
      dateOfBirth: student?.dateOfBirth || "",
      address: student?.address || "",
      courseType: student?.courseType || "auto",
      status: student?.status || "active",
      progress: student?.progress || 0,
      instructorId: student?.instructorId || null,
      locationId: student?.locationId || null,
      attestationNumber: student?.attestationNumber || "",
      emergencyContact: student?.emergencyContact || "",
      emergencyPhone: student?.emergencyPhone || "",
      userId: student?.userId || null,
      transferredFrom: student?.transferredFrom ?? null,
      learnerPermitNumber: student?.learnerPermitNumber ?? "",
      learnerPermitValidDate: (student as any)?.learnerPermitValidDate ?? "",
      learnerPermitExpiryDate: student?.learnerPermitExpiryDate ?? "",
      testScores: student?.testScores ?? null,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: StudentFormData) => apiRequest("POST", "/api/students", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      toast({
        title: "✓ Success",
        description: "Student created successfully",
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0"
      });
      form.reset();
      onSuccess();
    },
    onError: (error: any) => {
      console.error('Student creation error:', error);
      
      let errorTitle = "Error";
      let errorMessage = "Failed to create student";
      
      if (error?.data?.message) {
        const message = error.data.message.toLowerCase();
        
        if (message.includes("duplicate") || message.includes("already exists") || message.includes("unique")) {
          errorTitle = "Duplicate Student";
          if (message.includes("email")) {
            errorMessage = "A student with this email address already exists. Please use a different email.";
          } else {
            errorMessage = "This student already exists in the system. Please check the email address.";
          }
        } else {
          errorMessage = error.data.message;
        }
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      if (error?.data?.errors && Array.isArray(error.data.errors)) {
        const fieldErrors = error.data.errors.map((err: any) => {
          return `${err.path?.join('.')}: ${err.message}`;
        }).join(', ');
        errorMessage = fieldErrors;
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive"
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: StudentFormData) => apiRequest("PUT", `/api/students/${student!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      toast({
        title: "✓ Success",
        description: "Student updated successfully",
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0"
      });
      onSuccess();
    },
    onError: (error: any) => {
      console.error('Student update error:', error);
      
      let errorTitle = "Error";
      let errorMessage = "Failed to update student";
      
      if (error?.data?.message) {
        const message = error.data.message.toLowerCase();
        
        if (message.includes("duplicate") || message.includes("already exists") || message.includes("unique")) {
          errorTitle = "Duplicate Student";
          if (message.includes("email")) {
            errorMessage = "A student with this email address already exists. Please use a different email.";
          } else {
            errorMessage = "This student already exists in the system. Please check the email address.";
          }
        } else {
          errorMessage = error.data.message;
        }
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      if (error?.data?.errors && Array.isArray(error.data.errors)) {
        const fieldErrors = error.data.errors.map((err: any) => {
          return `${err.path?.join('.')}: ${err.message}`;
        }).join(', ');
        errorMessage = fieldErrors;
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive"
      });
    },
  });

  const onSubmit = (data: StudentFormData) => {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First Name *</FormLabel>
                <FormControl>
                  <Input placeholder="Enter first name" {...field} data-testid="input-first-name" />
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
                <FormLabel>Last Name *</FormLabel>
                <FormControl>
                  <Input placeholder="Enter last name" {...field} data-testid="input-last-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email *</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="Enter email address" {...field} data-testid="input-email" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mobile Phone *</FormLabel>
                <FormControl>
                  <Input placeholder="Enter mobile phone number" {...field} data-testid="input-phone" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="homePhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Home Phone</FormLabel>
                <FormControl>
                  <Input placeholder="Enter home phone number" {...field} value={field.value ?? ""} data-testid="input-home-phone" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="primaryLanguage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Primary Language</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value || "English"}>
                  <FormControl>
                    <SelectTrigger data-testid="select-primary-language">
                      <SelectValue placeholder="Select primary language" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="English">English</SelectItem>
                    <SelectItem value="French">French</SelectItem>
                    <SelectItem value="Spanish">Spanish</SelectItem>
                    <SelectItem value="Italian">Italian</SelectItem>
                    <SelectItem value="Portuguese">Portuguese</SelectItem>
                    <SelectItem value="Arabic">Arabic</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="dateOfBirth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date of Birth *</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-date-of-birth" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="courseType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Course Type *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-course-type">
                      <SelectValue placeholder="Select course type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="auto">Auto - $1,200</SelectItem>
                    <SelectItem value="moto">Moto - $800</SelectItem>
                    <SelectItem value="scooter">Scooter - $600</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address *</FormLabel>
              <FormControl>
                <Textarea placeholder="Enter full address" {...field} data-testid="textarea-address" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl>
                  <Input placeholder="Enter city" {...field} value={field.value ?? ""} data-testid="input-city" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="postalCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Postal Code</FormLabel>
                <FormControl>
                  <Input placeholder="Enter postal code" {...field} value={field.value ?? ""} data-testid="input-postal-code" />
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
                <FormLabel>Province</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value || "QC"}>
                  <FormControl>
                    <SelectTrigger data-testid="select-province">
                      <SelectValue placeholder="Select province" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="QC">Quebec</SelectItem>
                    <SelectItem value="ON">Ontario</SelectItem>
                    <SelectItem value="BC">British Columbia</SelectItem>
                    <SelectItem value="AB">Alberta</SelectItem>
                    <SelectItem value="MB">Manitoba</SelectItem>
                    <SelectItem value="SK">Saskatchewan</SelectItem>
                    <SelectItem value="NS">Nova Scotia</SelectItem>
                    <SelectItem value="NB">New Brunswick</SelectItem>
                    <SelectItem value="PE">Prince Edward Island</SelectItem>
                    <SelectItem value="NL">Newfoundland and Labrador</SelectItem>
                    <SelectItem value="NT">Northwest Territories</SelectItem>
                    <SelectItem value="NU">Nunavut</SelectItem>
                    <SelectItem value="YT">Yukon</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="emergencyContact"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Emergency Contact *</FormLabel>
                <FormControl>
                  <Input placeholder="Contact person name" {...field} data-testid="input-emergency-contact" />
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
                <FormLabel>Emergency Phone *</FormLabel>
                <FormControl>
                  <Input placeholder="Emergency contact phone" {...field} data-testid="input-emergency-phone" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {isEditing && (
          <>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mt-4">Learner's Permit</h3>
            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="learnerPermitNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Permit Number</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter permit number" {...field} value={field.value ?? ""} data-testid="input-learner-permit-number" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="learnerPermitValidDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valid From</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ""} data-testid="input-permit-valid-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="learnerPermitExpiryDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expiry Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ""} data-testid="input-permit-expiry-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="on-hold">On Hold</SelectItem>
                    <SelectItem value="transferred">Transferred</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="instructorId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Instructor</FormLabel>
                <Select onValueChange={(value) => field.onChange(value === "none" ? null : parseInt(value))} defaultValue={field.value?.toString() || "none"}>
                  <FormControl>
                    <SelectTrigger data-testid="select-instructor">
                      <SelectValue placeholder="Select instructor" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">No Instructor</SelectItem>
                    {instructors.map((instructor) => (
                      <SelectItem key={instructor.id} value={instructor.id.toString()}>
                        {instructor.firstName} {instructor.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="locationId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Location</FormLabel>
                <Select onValueChange={(value) => field.onChange(value === "none" ? null : parseInt(value))} defaultValue={field.value?.toString() || "none"}>
                  <FormControl>
                    <SelectTrigger data-testid="select-location">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">No Location</SelectItem>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id.toString()}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="transferredFrom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Transferred From</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="Previous school name" 
                    {...field} 
                    value={field.value ?? ""} 
                    onChange={e => field.onChange(e.target.value === "" ? null : e.target.value)}
                    data-testid="input-transferred-from"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="progress"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Completed Classes (%)</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    min="0" 
                    max="100" 
                    placeholder="0"
                    {...field} 
                    onChange={e => field.onChange(parseInt(e.target.value) || 0)}
                    data-testid="input-progress"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {isEditing && (
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="attestationNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Attestation Number</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="e.g., ATT-2024-001" 
                      {...field} 
                      value={field.value ?? ""}
                      data-testid="input-attestation-number"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {isEditing && (
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="testScores"
              render={({ field }) => {
                const scores = (field.value as { module5Score?: number } | null) || {};
                const currentScore = scores.module5Score;
                return (
                  <FormItem>
                    <FormLabel>Module 5 Theory Test Score (out of 24)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="24"
                        placeholder="Enter score (0–24)"
                        value={currentScore !== undefined ? currentScore : ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "") {
                            field.onChange(null);
                          } else {
                            const num = parseInt(val);
                            if (!isNaN(num) && num >= 0 && num <= 24) {
                              field.onChange({ ...scores, module5Score: num });
                            }
                          }
                        }}
                        data-testid="input-module5-score"
                      />
                    </FormControl>
                    {currentScore !== undefined && (
                      <p className="text-xs text-gray-500 mt-1">
                        {currentScore}/24 — {Math.round((currentScore / 24) * 100)}% — {currentScore >= 20 ? '✓ Pass' : '✗ Fail'}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          </div>
        )}

        <div className="sticky bottom-0 bg-white dark:bg-gray-900 pt-4 mt-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row gap-4">
            <Button 
              type="submit" 
              disabled={isLoading}
              data-testid="button-submit-student"
              className="w-full sm:w-auto touch-target bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111]"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#111111]" />}
              {isLoading ? "Saving..." : isEditing ? "Update Student" : "Create Student"}
            </Button>
            <Button 
              type="button" 
              variant="outline" 
              onClick={onSuccess}
              className="w-full sm:w-auto touch-target"
              data-testid="button-cancel"
            >
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
