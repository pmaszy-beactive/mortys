import { useRef, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertEvaluationSchema, type Evaluation, type Student, type Instructor } from "@shared/schema";
import { z } from "zod";
import SignaturePad, { SignaturePadRef } from "./signature-pad";
import SignatureDisplay from "./signature-display";
import { CheckCircle, PenTool, User, FileCheck } from "lucide-react";

type EvaluationStep = 'form' | 'instructor_sign' | 'student_sign' | 'ready_to_submit';

const evaluationFormSchema = insertEvaluationSchema.extend({
  evaluationDate: z.string().min(1, "Evaluation date is required"),
  sessionType: z.string().min(1, "Session type is required"),
});

type EvaluationFormData = z.infer<typeof evaluationFormSchema>;

interface EvaluationFormProps {
  evaluation?: Partial<Evaluation>;
  onSuccess: () => void;
  prefilledData?: {
    studentId?: number;
    studentName?: string;
    instructorId?: number;
    instructorName?: string;
    classId?: number;
    sessionType?: string;
  };
}

const drivingChecklistCategories = {
  "Stopping": [
    "Makes full stops",
    "Looks left-right-left",
    "Stops before stop line or pole",
    "Performs double stops when required",
    "Starts braking early enough"
  ],
  "Turning": [
    "Uses hand over hand steering",
    "Turns into proper lane",
    "Signals and checks blind spots",
    "Handles boulevards properly",
    "Navigates side streets correctly"
  ],
  "Lane Changes": [
    "Hesitates appropriately before changing",
    "Signals before lane changes",
    "Checks blind spots",
    "Uses mirrors effectively",
    "Builds confidence in lane changes"
  ],
  "Acceleration/Deceleration": [
    "Avoids sudden acceleration",
    "Avoids abrupt deceleration", 
    "Manages heavy foot tendency",
    "Smooth speed transitions"
  ],
  "Parking": [
    "Parallel parking",
    "Reverse park 90 degrees",
    "Front parking",
    "Proper positioning within space"
  ],
  "Highway": [
    "Student went on highway",
    "Merging technique",
    "Checks mirrors regularly",
    "Maintains speed limit",
    "Lane discipline on highway"
  ],
  "Practice at Home": [
    "Student practices at home",
    "Regular practice schedule",
    "Improvement noted from practice"
  ]
};

// Flatten categories for form handling
const drivingChecklistItems = Object.entries(drivingChecklistCategories).flatMap(([category, items]) => 
  items.map(item => `${category}: ${item}`)
);

export default function EvaluationForm({ evaluation, onSuccess, prefilledData }: EvaluationFormProps) {
  const { toast } = useToast();
  const isEditing = !!evaluation;
  const instructorSignaturePadRef = useRef<SignaturePadRef>(null);
  const studentSignaturePadRef = useRef<SignaturePadRef>(null);
  const [currentStep, setCurrentStep] = useState<EvaluationStep>('form');
  const [instructorSignatureData, setInstructorSignatureData] = useState<string | null>(null);
  const [studentSignatureData, setStudentSignatureData] = useState<string | null>(null);
  const [formData, setFormData] = useState<EvaluationFormData | null>(null);
  const [location] = useLocation();
  
  // Detect if we're in instructor portal
  const isInstructorPortal = location.startsWith('/instructor');

  // Fetch students - use instructor endpoint if in instructor portal
  const { data: studentsData } = useQuery<Student[] | {students: Student[]}>({
    queryKey: isInstructorPortal ? ["/api/instructor/students"] : ["/api/students"],
  });
  
  // Handle both response formats (array for instructor, object for admin)
  const students = Array.isArray(studentsData) ? studentsData : (studentsData?.students || []);

  // Fetch current instructor info if in instructor portal
  const { data: currentInstructor } = useQuery<Instructor>({
    queryKey: ["/api/instructor/me"],
    enabled: isInstructorPortal,
  });

  // Fetch all instructors if in admin portal
  const { data: allInstructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
    enabled: !isInstructorPortal,
  });

  // Determine which instructors list to use
  const instructors = isInstructorPortal 
    ? (currentInstructor ? [currentInstructor] : [])
    : allInstructors;

  const buildChecklistDefaults = () => {
    // Always build full checklist template with all keys initialized as false
    const checklist: Record<string, boolean> = {};
    
    // Add all individual items
    drivingChecklistItems.forEach(item => {
      checklist[item] = false;
      // Add individual N/A option for each item
      checklist[`${item}: N/A`] = false;
    });
    
    // Add N/A options for each category
    Object.keys(drivingChecklistCategories).forEach(category => {
      checklist[`${category}: N/A`] = false;
    });
    
    return checklist;
  };

  const getInitialChecklist = () => {
    const defaults = buildChecklistDefaults();
    const existing = evaluation?.checklist ?? {};
    return { ...defaults, ...existing };
  };

  // Determine if fields should be locked (when tied to a specific class)
  const isClassContext = !!prefilledData?.classId;

  const form = useForm<EvaluationFormData>({
    resolver: zodResolver(evaluationFormSchema),
    defaultValues: {
      studentId: evaluation?.studentId || prefilledData?.studentId || null,
      instructorId: evaluation?.instructorId || prefilledData?.instructorId || (isInstructorPortal && currentInstructor ? currentInstructor.id : null),
      classId: evaluation?.classId || prefilledData?.classId || null,
      evaluationDate: evaluation?.evaluationDate || new Date().toISOString().split('T')[0],
      sessionType: evaluation?.sessionType || prefilledData?.sessionType || "in-car",
      strengths: evaluation?.strengths || "",
      weaknesses: evaluation?.weaknesses || "",
      checklist: getInitialChecklist(),
      overallRating: evaluation?.overallRating || 3,
      notes: evaluation?.notes || "",
      signedOff: evaluation?.signedOff || false,
    },
  });

  // Auto-set instructor ID when in instructor portal
  useEffect(() => {
    if (isInstructorPortal && currentInstructor && !evaluation) {
      form.setValue('instructorId', currentInstructor.id);
    }
  }, [currentInstructor, isInstructorPortal, evaluation, form]);

  const createMutation = useMutation({
    mutationFn: (data: EvaluationFormData) => apiRequest("POST", isInstructorPortal ? "/api/instructor/evaluations" : "/api/evaluations", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/evaluations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/evaluations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/classes-needing-evaluation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/dashboard"] });
      toast({
        title: "Success",
        description: "Evaluation created successfully",
      });
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create evaluation",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: EvaluationFormData) => apiRequest("PUT", isInstructorPortal ? `/api/instructor/evaluations/${evaluation!.id}` : `/api/evaluations/${evaluation!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/evaluations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/evaluations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/classes-needing-evaluation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/dashboard"] });
      toast({
        title: "Success",
        description: "Evaluation updated successfully",
      });
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update evaluation",
        variant: "destructive",
      });
    },
  });

  const handleProceedToInstructorSign = (data: EvaluationFormData) => {
    setFormData(data);
    setCurrentStep('instructor_sign');
  };

  const handleInstructorConfirm = () => {
    const signature = instructorSignaturePadRef.current?.getSignature();
    if (!signature) {
      toast({
        title: "Signature Required",
        description: "Please provide your digital signature before confirming.",
        variant: "destructive",
      });
      return;
    }
    setInstructorSignatureData(signature);
    setCurrentStep('student_sign');
  };

  const handleStudentConfirm = () => {
    const signature = studentSignaturePadRef.current?.getSignature();
    if (!signature) {
      toast({
        title: "Signature Required",
        description: "Please ask the student to provide their digital signature before confirming.",
        variant: "destructive",
      });
      return;
    }
    setStudentSignatureData(signature);
    setCurrentStep('ready_to_submit');
  };

  const handleFinalSubmit = () => {
    if (!formData || !instructorSignatureData || !studentSignatureData) {
      toast({
        title: "Error",
        description: "Missing required data. Please start over.",
        variant: "destructive",
      });
      return;
    }

    const evaluationData = {
      ...formData,
      signedOff: true,
      instructorSignature: instructorSignatureData,
      signatureDate: new Date().toISOString(),
      signatureIpAddress: "127.0.0.1",
      studentSignature: studentSignatureData,
      studentSignatureDate: new Date().toISOString(),
    };

    if (isEditing) {
      updateMutation.mutate(evaluationData);
    } else {
      createMutation.mutate(evaluationData);
    }
  };

  const onSubmit = (data: EvaluationFormData) => {
    if (isInstructorPortal) {
      handleProceedToInstructorSign(data);
    } else {
      if (isEditing) {
        updateMutation.mutate(data);
      } else {
        createMutation.mutate(data);
      }
    }
  };

  const handleChecklistChange = (item: string, checked: boolean) => {
    const currentChecklist = form.getValues("checklist") as Record<string, boolean>;
    form.setValue("checklist", {
      ...currentChecklist,
      [item]: checked
    });
  };

  const handleCategoryNAChange = (category: string, checked: boolean) => {
    const currentChecklist = form.getValues("checklist") as Record<string, boolean>;
    const naKey = `${category}: N/A`;
    
    // If marking as N/A, uncheck all items and individual N/As in this category
    if (checked) {
      const updatedChecklist = { ...currentChecklist };
      drivingChecklistCategories[category as keyof typeof drivingChecklistCategories].forEach(item => {
        const itemKey = `${category}: ${item}`;
        const itemNAKey = `${itemKey}: N/A`;
        updatedChecklist[itemKey] = false;
        updatedChecklist[itemNAKey] = false;
      });
      updatedChecklist[naKey] = true;
      form.setValue("checklist", updatedChecklist);
    } else {
      // If unchecking N/A, just remove the N/A flag
      form.setValue("checklist", {
        ...currentChecklist,
        [naKey]: false
      });
    }
  };

  const handleItemNAChange = (itemKey: string, checked: boolean) => {
    const currentChecklist = form.getValues("checklist") as Record<string, boolean>;
    const itemNAKey = `${itemKey}: N/A`;
    
    // If marking item as N/A, uncheck the item itself
    if (checked) {
      form.setValue("checklist", {
        ...currentChecklist,
        [itemKey]: false,
        [itemNAKey]: true
      });
    } else {
      // If unchecking item N/A, just remove the N/A flag
      form.setValue("checklist", {
        ...currentChecklist,
        [itemNAKey]: false
      });
    }
  };

  const isItemNA = (itemKey: string) => {
    const checklist = form.getValues("checklist") as Record<string, boolean>;
    return checklist[`${itemKey}: N/A`] || false;
  };

  const isCategoryNA = (category: string) => {
    const checklist = form.getValues("checklist") as Record<string, boolean>;
    return checklist[`${category}: N/A`] || false;
  };

  const renderForm = () => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="studentId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Student</FormLabel>
                {isClassContext && prefilledData?.studentName ? (
                  <div className="flex items-center h-10 px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-gray-700">
                    <span className="font-medium" data-testid="text-locked-student">{prefilledData.studentName}</span>
                  </div>
                ) : (
                  <Select onValueChange={(value) => field.onChange(parseInt(value))} defaultValue={field.value?.toString() || ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select student..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {students.map((student) => (
                        <SelectItem key={student.id} value={student.id.toString()}>
                          {student.firstName} {student.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
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
                {isClassContext && prefilledData?.instructorName ? (
                  <div className="flex items-center h-10 px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-gray-700">
                    <span className="font-medium" data-testid="text-locked-instructor">{prefilledData.instructorName}</span>
                  </div>
                ) : (
                  <Select onValueChange={(value) => field.onChange(parseInt(value))} defaultValue={field.value?.toString() || ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select instructor..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {instructors.map((instructor) => (
                        <SelectItem key={instructor.id} value={instructor.id.toString()}>
                          {instructor.firstName} {instructor.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="evaluationDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Evaluation Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sessionType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Session Type</FormLabel>
                {isClassContext ? (
                  <div className="flex items-center h-10 px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-gray-700">
                    <span className="font-medium" data-testid="text-locked-session-type">In-Car Session</span>
                  </div>
                ) : (
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select session type..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="in-car">In-Car Session</SelectItem>
                      <SelectItem value="theory">Theory Session</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Checklist for in-car sessions */}
        {form.watch("sessionType") === "in-car" && (
          <FormField
            control={form.control}
            name="checklist"
            render={() => (
              <FormItem>
                <FormLabel className="text-base">Driving Skills Checklist</FormLabel>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  {Object.entries(drivingChecklistCategories).map(([category, items]) => {
                    const isNA = isCategoryNA(category);
                    const checklist = form.getValues("checklist") as Record<string, boolean>;
                    
                    return (
                      <div key={category} className="space-y-3">
                        <div className="flex items-center justify-between border-b pb-1">
                          <h4 className={`font-semibold ${isNA ? 'text-gray-400' : 'text-gray-900'}`}>
                            {category}
                          </h4>
                          <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={isNA}
                                onCheckedChange={(checked) => {
                                  handleCategoryNAChange(category, !!checked);
                                }}
                                className="data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                                data-testid={`na-checkbox-category-${category.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                              />
                            </FormControl>
                            <FormLabel className="text-xs text-orange-600 font-medium">
                              N/A
                            </FormLabel>
                          </FormItem>
                        </div>
                        <div className={`grid grid-cols-1 gap-2 pl-4 ${isNA ? 'opacity-50' : ''}`}>
                          {items.map((item) => {
                            const checklistKey = `${category}: ${item}`;
                            const itemIsNA = isItemNA(checklistKey);
                            return (
                              <FormItem
                                key={checklistKey}
                                className="flex flex-row items-center justify-between space-y-0"
                              >
                                <div className="flex flex-row items-center space-x-3">
                                  <FormControl>
                                    <Checkbox
                                      checked={checklist[checklistKey] || false}
                                      disabled={isNA || itemIsNA}
                                      onCheckedChange={(checked) => {
                                        handleChecklistChange(checklistKey, !!checked);
                                      }}
                                      data-testid={`checkbox-${checklistKey.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                                    />
                                  </FormControl>
                                  <FormLabel className={`font-normal text-sm ${isNA || itemIsNA ? 'text-gray-400' : ''}`}>
                                    {item}
                                  </FormLabel>
                                </div>
                                <FormItem className="flex flex-row items-center space-x-1 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={itemIsNA}
                                      disabled={isNA}
                                      onCheckedChange={(checked) => {
                                        handleItemNAChange(checklistKey, !!checked);
                                      }}
                                      className="h-3 w-3 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                                      data-testid={`na-checkbox-${checklistKey.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-xs text-orange-600 font-medium">
                                    N/A
                                  </FormLabel>
                                </FormItem>
                              </FormItem>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="strengths"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Strengths</FormLabel>
                <FormControl>
                  <Textarea 
                    placeholder="Note the student's strengths..." 
                    rows={3}
                    {...field}
                    value={field.value || ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="weaknesses"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Areas for Improvement</FormLabel>
                <FormControl>
                  <Textarea 
                    placeholder="Note areas that need improvement..." 
                    rows={3}
                    {...field}
                    value={field.value || ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="overallRating"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Overall Rating (1-5)</FormLabel>
                <Select onValueChange={(value) => field.onChange(parseInt(value))} defaultValue={field.value?.toString() || "3"}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select rating..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="1">1 - Needs Significant Improvement</SelectItem>
                    <SelectItem value="2">2 - Below Average</SelectItem>
                    <SelectItem value="3">3 - Average</SelectItem>
                    <SelectItem value="4">4 - Above Average</SelectItem>
                    <SelectItem value="5">5 - Excellent</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="signedOff"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                    }}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>
                    Sign Off Complete
                  </FormLabel>
                  <p className="text-sm text-muted-foreground">
                    Mark this evaluation as signed off and complete
                  </p>
                </div>
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Additional Notes</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Any additional observations or notes..." 
                  rows={4}
                  {...field}
                  value={field.value || ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Display existing signatures for editing mode */}
        {evaluation?.instructorSignature && (
          <>
            <Separator className="my-6" />
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Signed Evaluation</h3>
              <SignatureDisplay
                signature={evaluation.instructorSignature}
                instructorName={instructors.find(i => i.id === evaluation.instructorId)?.firstName + " " + instructors.find(i => i.id === evaluation.instructorId)?.lastName}
                signatureDate={evaluation.signatureDate || undefined}
                ipAddress={evaluation.signatureIpAddress || undefined}
                title="Instructor Sign-Off"
              />
            </div>
          </>
        )}

        <div className="flex flex-col sm:flex-row gap-4 pt-4">
          <Button 
            type="submit" 
            disabled={createMutation.isPending || updateMutation.isPending}
            className="w-full sm:w-auto touch-target"
          >
            {isInstructorPortal && !isEditing ? "Proceed to Signatures" : createMutation.isPending || updateMutation.isPending ? "Saving..." : isEditing ? "Update Evaluation" : "Create Evaluation"}
          </Button>
          <Button 
            type="button" 
            variant="outline" 
            onClick={onSuccess}
            className="w-full sm:w-auto touch-target"
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );

  const renderStepProgress = () => (
    <div className="flex items-center justify-center gap-2 mb-6">
      <div className={`flex items-center gap-2 px-3 py-2 rounded-full ${currentStep === 'form' ? 'bg-[#ECC462] text-[#111111]' : 'bg-gray-200 text-gray-600'}`}>
        <FileCheck className="h-4 w-4" />
        <span className="text-sm font-medium">1. Fill Form</span>
      </div>
      <div className="w-8 h-0.5 bg-gray-300" />
      <div className={`flex items-center gap-2 px-3 py-2 rounded-full ${currentStep === 'instructor_sign' ? 'bg-[#ECC462] text-[#111111]' : instructorSignatureData ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
        <PenTool className="h-4 w-4" />
        <span className="text-sm font-medium">2. Instructor Signs</span>
      </div>
      <div className="w-8 h-0.5 bg-gray-300" />
      <div className={`flex items-center gap-2 px-3 py-2 rounded-full ${currentStep === 'student_sign' ? 'bg-[#ECC462] text-[#111111]' : studentSignatureData ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
        <User className="h-4 w-4" />
        <span className="text-sm font-medium">3. Student Signs</span>
      </div>
      <div className="w-8 h-0.5 bg-gray-300" />
      <div className={`flex items-center gap-2 px-3 py-2 rounded-full ${currentStep === 'ready_to_submit' ? 'bg-[#ECC462] text-[#111111]' : 'bg-gray-200 text-gray-600'}`}>
        <CheckCircle className="h-4 w-4" />
        <span className="text-sm font-medium">4. Complete</span>
      </div>
    </div>
  );

  const renderInstructorSignStep = () => (
    <div className="space-y-6">
      {renderStepProgress()}
      <Card className="border-2 border-[#ECC462]">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-xl">
            <PenTool className="h-6 w-6 text-[#ECC462]" />
            Instructor Signature
          </CardTitle>
          <CardDescription>
            Please review the evaluation and sign below to confirm the details are accurate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="font-semibold mb-2">Evaluation Summary</h4>
            <p className="text-sm text-gray-600">
              Student: {prefilledData?.studentName || 'Selected Student'} | 
              Session Type: {formData?.sessionType || 'N/A'} | 
              Rating: {formData?.overallRating || 'N/A'}/5
            </p>
          </div>
          
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              By signing below, I confirm that this evaluation accurately reflects the student's performance during this session.
            </p>
            <SignaturePad
              ref={instructorSignaturePadRef}
              width={500}
              height={200}
              title="Instructor Signature"
            />
          </div>

          <div className="flex gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentStep('form')}
              className="flex-1"
            >
              Back to Form
            </Button>
            <Button
              type="button"
              onClick={handleInstructorConfirm}
              className="flex-1 bg-[#ECC462] hover:bg-[#d4b058] text-[#111111]"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Confirm Instructor Signature
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderStudentSignStep = () => (
    <div className="space-y-6">
      {renderStepProgress()}
      <Card className="border-2 border-blue-500">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-xl">
            <User className="h-6 w-6 text-blue-500" />
            Student Signature
          </CardTitle>
          <CardDescription>
            Please hand the device to the student to review and sign the evaluation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h4 className="font-semibold mb-2 text-blue-800">For the Student</h4>
            <p className="text-sm text-blue-700">
              Please review your evaluation results below and sign to acknowledge you have received this feedback.
            </p>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="font-semibold mb-2">Your Evaluation</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><strong>Session Type:</strong> {formData?.sessionType}</p>
              <p><strong>Overall Rating:</strong> {formData?.overallRating}/5</p>
              {formData?.strengths && <p className="col-span-2"><strong>Strengths:</strong> {formData.strengths}</p>}
              {formData?.weaknesses && <p className="col-span-2"><strong>Areas for Improvement:</strong> {formData.weaknesses}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <span className="text-sm text-green-700">Instructor has signed this evaluation</span>
          </div>
          
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              By signing below, I acknowledge that I have reviewed this evaluation and received feedback on my performance.
            </p>
            <SignaturePad
              ref={studentSignaturePadRef}
              width={500}
              height={200}
              title="Student Signature"
            />
          </div>

          <div className="flex gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentStep('instructor_sign')}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              type="button"
              onClick={handleStudentConfirm}
              className="flex-1 bg-blue-500 hover:bg-blue-600 text-white"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Confirm Student Signature
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderReadyToSubmit = () => (
    <div className="space-y-6">
      {renderStepProgress()}
      <Card className="border-2 border-green-500">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-xl text-green-600">
            <CheckCircle className="h-6 w-6" />
            Ready to Submit
          </CardTitle>
          <CardDescription>
            Both signatures have been collected. Review and submit the evaluation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <PenTool className="h-4 w-4 text-[#ECC462]" />
                Instructor Signature
              </h4>
              {instructorSignatureData && (
                <img src={instructorSignatureData} alt="Instructor Signature" className="max-h-24 border rounded bg-white p-2" />
              )}
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <User className="h-4 w-4 text-blue-500" />
                Student Signature
              </h4>
              {studentSignatureData && (
                <img src={studentSignatureData} alt="Student Signature" className="max-h-24 border rounded bg-white p-2" />
              )}
            </div>
          </div>

          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
            <h4 className="font-semibold mb-2 text-green-800">Evaluation Summary</h4>
            <div className="text-sm text-green-700 space-y-1">
              <p><strong>Student:</strong> {prefilledData?.studentName}</p>
              <p><strong>Session Type:</strong> {formData?.sessionType}</p>
              <p><strong>Overall Rating:</strong> {formData?.overallRating}/5</p>
              <p><strong>Date:</strong> {formData?.evaluationDate}</p>
            </div>
          </div>

          <div className="flex gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCurrentStep('form');
                setInstructorSignatureData(null);
                setStudentSignatureData(null);
              }}
              className="flex-1"
            >
              Start Over
            </Button>
            <Button
              type="button"
              onClick={handleFinalSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              {createMutation.isPending || updateMutation.isPending ? (
                "Creating..."
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Create Evaluation
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  if (isInstructorPortal && !isEditing) {
    switch (currentStep) {
      case 'instructor_sign':
        return renderInstructorSignStep();
      case 'student_sign':
        return renderStudentSignStep();
      case 'ready_to_submit':
        return renderReadyToSubmit();
      default:
        return (
          <div className="space-y-6">
            {renderStepProgress()}
            {renderForm()}
          </div>
        );
    }
  }

  return renderForm();
}
