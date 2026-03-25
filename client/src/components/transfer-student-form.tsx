import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertStudentSchema, type Student, type Instructor, type Location } from "@shared/schema";
import { z } from "zod";
import { Loader2, BookOpen, Car, ArrowRightLeft, CheckCircle2 } from "lucide-react";

// Course structure constants
const COURSE_STRUCTURE: Record<string, { theoryClasses: number; drivingSessions: number; theoryHoursEach: number; drivingHoursEach: number }> = {
  auto:    { theoryClasses: 12, drivingSessions: 15, theoryHoursEach: 2.5, drivingHoursEach: 1 },
  moto:    { theoryClasses: 8,  drivingSessions: 10, theoryHoursEach: 2,   drivingHoursEach: 1 },
  scooter: { theoryClasses: 6,  drivingSessions: 8,  theoryHoursEach: 2,   drivingHoursEach: 1 },
};

const transferStudentSchema = insertStudentSchema.extend({
  firstName: z.string().min(2, "First name must be at least 2 characters"),
  lastName: z.string().min(2, "Last name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().regex(/^[\d\s\-\(\)\+]+$/, "Valid phone number required").min(10, "At least 10 digits"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  address: z.string().min(5, "Address is required"),
  emergencyContact: z.string().min(2, "Emergency contact required"),
  emergencyPhone: z.string().regex(/^[\d\s\-\(\)\+]+$/, "Valid phone required").min(10, "At least 10 digits"),
  courseType: z.string().min(1, "Course type is required"),
  transferredFrom: z.string().min(1, "Previous school name is required"),
  homePhone: z.string().optional().refine((val) => {
    if (!val || val.length === 0) return true;
    return /^[\d\s\-\(\)\+]+$/.test(val) && val.replace(/\D/g, '').length >= 10;
  }, "Valid phone number required"),
  primaryLanguage: z.string().optional(),
}).partial({
  city: true, postalCode: true, province: true, country: true,
  favoriteInstructorId: true, legacyId: true, enrollmentDate: true,
  completionDate: true, transferredCredits: true, totalHoursCompleted: true,
  totalHoursRequired: true, theoryHoursCompleted: true, practicalHoursCompleted: true,
  totalAmountDue: true, amountPaid: true, paymentPlan: true, lastPaymentDate: true,
  governmentId: true, driverLicenseNumber: true, licenseExpiryDate: true,
  medicalCertificate: true, visionTest: true, profilePhoto: true,
  digitalSignature: true, signatureConsent: true, testScores: true,
  finalExamScore: true, roadTestDate: true, roadTestResult: true,
  specialNeeds: true, accommodations: true, languagePreference: true,
});

type TransferStudentFormData = z.infer<typeof transferStudentSchema>;

interface TransferStudentFormProps {
  onSuccess: () => void;
}

export default function TransferStudentForm({ onSuccess }: TransferStudentFormProps) {
  const { toast } = useToast();

  const [completedTheoryClasses, setCompletedTheoryClasses] = useState<number[]>([]);
  const [completedDrivingSessions, setCompletedDrivingSessions] = useState<number[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>("auto");

  const courseConfig = COURSE_STRUCTURE[selectedCourse] || COURSE_STRUCTURE.auto;
  const totalItems = courseConfig.theoryClasses + courseConfig.drivingSessions;
  const completedItems = completedTheoryClasses.length + completedDrivingSessions.length;
  const progressPercent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  const theoryHoursCompleted = Math.round(completedTheoryClasses.length * courseConfig.theoryHoursEach);
  const drivingHoursCompleted = Math.round(completedDrivingSessions.length * courseConfig.drivingHoursEach);

  const { data: instructors = [] } = useQuery<Instructor[]>({ queryKey: ["/api/instructors"] });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  const form = useForm<TransferStudentFormData>({
    resolver: zodResolver(transferStudentSchema),
    defaultValues: {
      firstName: "", lastName: "", email: "", phone: "", homePhone: "",
      primaryLanguage: "English", dateOfBirth: "", address: "",
      courseType: "auto", status: "active", progress: 0,
      instructorId: null, locationId: null, attestationNumber: "",
      emergencyContact: "", emergencyPhone: "",
      userId: null, transferredFrom: "",
      learnerPermitNumber: "", learnerPermitValidDate: "", learnerPermitExpiryDate: "",
    },
  });

  // Keep selectedCourse in sync with form value
  const watchedCourse = form.watch("courseType");
  useEffect(() => {
    setSelectedCourse(watchedCourse || "auto");
    // Reset selections when course changes
    setCompletedTheoryClasses([]);
    setCompletedDrivingSessions([]);
  }, [watchedCourse]);

  const toggleTheoryClass = (num: number) => {
    setCompletedTheoryClasses(prev =>
      prev.includes(num) ? prev.filter(n => n !== num) : [...prev, num].sort((a, b) => a - b)
    );
  };

  const toggleDrivingSession = (num: number) => {
    setCompletedDrivingSessions(prev =>
      prev.includes(num) ? prev.filter(n => n !== num) : [...prev, num].sort((a, b) => a - b)
    );
  };

  const selectAllTheory = () => {
    const all = Array.from({ length: courseConfig.theoryClasses }, (_, i) => i + 1);
    setCompletedTheoryClasses(all);
  };

  const selectAllDriving = () => {
    const all = Array.from({ length: courseConfig.drivingSessions }, (_, i) => i + 1);
    setCompletedDrivingSessions(all);
  };

  const createMutation = useMutation({
    mutationFn: (data: TransferStudentFormData) => {
      const currentTheoryClass = completedTheoryClasses.length > 0
        ? Math.max(...completedTheoryClasses) + 1
        : 1;
      const currentInCarSession = completedDrivingSessions.length > 0
        ? Math.max(...completedDrivingSessions) + 1
        : 1;

      const payload = {
        ...data,
        completedTheoryClasses: completedTheoryClasses,
        completedInCarSessions: completedDrivingSessions,
        currentTheoryClass: Math.min(currentTheoryClass, courseConfig.theoryClasses),
        currentInCarSession: Math.min(currentInCarSession, courseConfig.drivingSessions),
        progress: progressPercent,
        theoryHoursCompleted,
        practicalHoursCompleted: drivingHoursCompleted,
        totalHoursCompleted: theoryHoursCompleted + drivingHoursCompleted,
      };
      return apiRequest("POST", "/api/students", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      toast({ title: "Success", description: "Transfer student added successfully" });
      form.reset();
      setCompletedTheoryClasses([]);
      setCompletedDrivingSessions([]);
      onSuccess();
    },
    onError: (error: any) => {
      let errorMessage = "Failed to create student";
      if (error?.data?.message) {
        const msg = error.data.message.toLowerCase();
        if (msg.includes("duplicate") || msg.includes("already exists") || msg.includes("unique")) {
          errorMessage = "A student with this email already exists.";
        } else {
          errorMessage = error.data.message;
        }
      }
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
    },
  });

  const onSubmit = (data: TransferStudentFormData) => {
    createMutation.mutate(data);
  };

  const isLoading = createMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 p-1">

        {/* Personal Info */}
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="w-4 h-4 bg-[#ECC462] rounded-sm inline-block"></span>
            Personal Information
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="firstName" render={({ field }) => (
                <FormItem><FormLabel>First Name *</FormLabel>
                  <FormControl><Input placeholder="First name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="lastName" render={({ field }) => (
                <FormItem><FormLabel>Last Name *</FormLabel>
                  <FormControl><Input placeholder="Last name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email *</FormLabel>
                  <FormControl><Input type="email" placeholder="Email address" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Mobile Phone *</FormLabel>
                  <FormControl><Input placeholder="Phone number" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="homePhone" render={({ field }) => (
                <FormItem><FormLabel>Home Phone</FormLabel>
                  <FormControl><Input placeholder="Home phone (optional)" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="dateOfBirth" render={({ field }) => (
                <FormItem><FormLabel>Date of Birth *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="address" render={({ field }) => (
              <FormItem><FormLabel>Address *</FormLabel>
                <FormControl><Textarea placeholder="Full address" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem><FormLabel>City</FormLabel>
                  <FormControl><Input placeholder="City" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="postalCode" render={({ field }) => (
                <FormItem><FormLabel>Postal Code</FormLabel>
                  <FormControl><Input placeholder="Postal code" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="province" render={({ field }) => (
                <FormItem><FormLabel>Province</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value || "QC"}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {[["QC","Quebec"],["ON","Ontario"],["BC","British Columbia"],["AB","Alberta"],["MB","Manitoba"],["SK","Saskatchewan"],["NS","Nova Scotia"],["NB","New Brunswick"],["PE","PEI"],["NL","Newfoundland"],["NT","NWT"],["NU","Nunavut"],["YT","Yukon"]].map(([v,l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="emergencyContact" render={({ field }) => (
                <FormItem><FormLabel>Emergency Contact *</FormLabel>
                  <FormControl><Input placeholder="Contact name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="emergencyPhone" render={({ field }) => (
                <FormItem><FormLabel>Emergency Phone *</FormLabel>
                  <FormControl><Input placeholder="Emergency phone" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </div>
        </div>

        {/* Enrollment Info */}
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="w-4 h-4 bg-[#ECC462] rounded-sm inline-block"></span>
            Enrollment
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="courseType" render={({ field }) => (
              <FormItem><FormLabel>Course Type *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="moto">Moto</SelectItem>
                    <SelectItem value="scooter">Scooter</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem><FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="on-hold">On Hold</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="instructorId" render={({ field }) => (
              <FormItem><FormLabel>Assigned Instructor</FormLabel>
                <Select onValueChange={(v) => field.onChange(v === "none" ? null : parseInt(v))} defaultValue={field.value?.toString() || "none"}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select instructor" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">No Instructor</SelectItem>
                    {instructors.map(i => (
                      <SelectItem key={i.id} value={i.id.toString()}>{i.firstName} {i.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="locationId" render={({ field }) => (
              <FormItem><FormLabel>Location</FormLabel>
                <Select onValueChange={(v) => field.onChange(v === "none" ? null : parseInt(v))} defaultValue={field.value?.toString() || "none"}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">No Location</SelectItem>
                    {locations.map(l => (
                      <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

        {/* Transfer Information */}
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-[#ECC462]" />
            Transfer Information
          </h3>

          <FormField control={form.control} name="transferredFrom" render={({ field }) => (
            <FormItem className="mb-4">
              <FormLabel>Previous Driving School *</FormLabel>
              <FormControl><Input placeholder="Name of previous school" {...field} value={field.value ?? ""} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />

          {/* Progress Summary */}
          <div className="bg-gray-50 border border-gray-200 rounded-md p-4 mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Transfer Credit Summary</span>
              <Badge className="bg-[#ECC462]/20 text-[#111111] border border-[#ECC462]/40 font-semibold">
                {progressPercent}% Complete
              </Badge>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div
                className="bg-[#ECC462] h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-white border border-gray-100 rounded p-2">
                <p className="text-lg font-bold text-gray-900">{completedTheoryClasses.length}<span className="text-gray-400 font-normal text-sm">/{courseConfig.theoryClasses}</span></p>
                <p className="text-xs text-gray-500">Theory Classes</p>
              </div>
              <div className="bg-white border border-gray-100 rounded p-2">
                <p className="text-lg font-bold text-gray-900">{completedDrivingSessions.length}<span className="text-gray-400 font-normal text-sm">/{courseConfig.drivingSessions}</span></p>
                <p className="text-xs text-gray-500">Driving Sessions</p>
              </div>
              <div className="bg-white border border-gray-100 rounded p-2">
                <p className="text-lg font-bold text-gray-900">{theoryHoursCompleted + drivingHoursCompleted}<span className="text-gray-400 font-normal text-sm">h</span></p>
                <p className="text-xs text-gray-500">Total Hours</p>
              </div>
            </div>
          </div>

          {/* Theory Classes Checkboxes */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#ECC462]" />
                <span className="text-sm font-semibold text-gray-700">Theory Classes Completed</span>
                {completedTheoryClasses.length > 0 && (
                  <span className="text-xs bg-[#ECC462]/15 text-[#111111] border border-[#ECC462]/30 px-1.5 py-0.5 rounded font-medium">
                    {completedTheoryClasses.length} selected
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {completedTheoryClasses.length < courseConfig.theoryClasses && (
                  <button type="button" onClick={selectAllTheory} className="text-xs text-[#ECC462] hover:underline font-medium">
                    Select all
                  </button>
                )}
                {completedTheoryClasses.length > 0 && (
                  <button type="button" onClick={() => setCompletedTheoryClasses([])} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: courseConfig.theoryClasses }, (_, i) => i + 1).map(num => {
                const isDone = completedTheoryClasses.includes(num);
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => toggleTheoryClass(num)}
                    className={`relative flex flex-col items-center justify-center p-2.5 rounded-md border text-sm font-semibold transition-all ${
                      isDone
                        ? "bg-[#ECC462]/10 border-[#ECC462] text-[#111111]"
                        : "bg-white border-gray-200 text-gray-400 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {isDone && (
                      <CheckCircle2 className="absolute top-0.5 right-0.5 h-3 w-3 text-[#ECC462]" />
                    )}
                    <span className="text-xs text-gray-400 font-normal leading-none mb-0.5">Class</span>
                    <span>{num}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Driving Sessions Checkboxes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Car className="h-4 w-4 text-[#ECC462]" />
                <span className="text-sm font-semibold text-gray-700">Driving Sessions Completed</span>
                {completedDrivingSessions.length > 0 && (
                  <span className="text-xs bg-[#ECC462]/15 text-[#111111] border border-[#ECC462]/30 px-1.5 py-0.5 rounded font-medium">
                    {completedDrivingSessions.length} selected
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {completedDrivingSessions.length < courseConfig.drivingSessions && (
                  <button type="button" onClick={selectAllDriving} className="text-xs text-[#ECC462] hover:underline font-medium">
                    Select all
                  </button>
                )}
                {completedDrivingSessions.length > 0 && (
                  <button type="button" onClick={() => setCompletedDrivingSessions([])} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: courseConfig.drivingSessions }, (_, i) => i + 1).map(num => {
                const isDone = completedDrivingSessions.includes(num);
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => toggleDrivingSession(num)}
                    className={`relative flex flex-col items-center justify-center p-2.5 rounded-md border text-sm font-semibold transition-all ${
                      isDone
                        ? "bg-[#ECC462]/10 border-[#ECC462] text-[#111111]"
                        : "bg-white border-gray-200 text-gray-400 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {isDone && (
                      <CheckCircle2 className="absolute top-0.5 right-0.5 h-3 w-3 text-[#ECC462]" />
                    )}
                    <span className="text-xs text-gray-400 font-normal leading-none mb-0.5">Session</span>
                    <span>{num}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium shadow-sm"
          >
            {isLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding Student...</>
            ) : (
              <><ArrowRightLeft className="mr-2 h-4 w-4" /> Add Transfer Student</>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
