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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Users, GraduationCap, Calendar, User, CalendarDays, Clock, AlertTriangle, Mail, Send, Save, ChevronDown, Eye, CheckCircle2, Info } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertCommunicationSchema, type Communication, type Student, type Instructor, type Class } from "@shared/schema";
import { z } from "zod";
import { format } from "date-fns";

const messageFormSchema = insertCommunicationSchema.extend({
  subject: z.string().min(1, "Subject is required"),
  message: z.string().min(1, "Message is required"),
  messageType: z.string().min(1, "Message type is required"),
});

type MessageFormData = z.infer<typeof messageFormSchema>;

interface MessageFormProps {
  message?: Communication;
  onSuccess: () => void;
}

export default function MessageForm({ message, onSuccess }: MessageFormProps) {
  const { toast } = useToast();
  const isEditing = !!message;

  const { data: studentsData } = useQuery<{students: Student[]}>({
    queryKey: ["/api/students"],
  });
  
  const students = studentsData?.students || [];

  const { data: instructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
  });

  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
  });

  const form = useForm<MessageFormData>({
    resolver: zodResolver(messageFormSchema),
    defaultValues: {
      authorId: message?.authorId || 1,
      subject: message?.subject || "",
      message: message?.message || "",
      recipients: message?.recipients || [],
      messageType: message?.messageType || "general",
      sendDate: message?.sendDate || null,
      status: message?.status || "draft",
      openRate: message?.openRate || 0,
      clickRate: message?.clickRate || 0,
    },
  });

  const [sendOption, setSendOption] = useState<"now" | "schedule" | "draft">("draft");
  const [scheduleDate, setScheduleDate] = useState<string>("");
  const [scheduleTime, setScheduleTime] = useState<string>("");
  const [requestReadReceipt, setRequestReadReceipt] = useState(false);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [recipientTab, setRecipientTab] = useState("course-types");
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  
  // Timeline-based messaging state
  const [selectedInstructorId, setSelectedInstructorId] = useState<number | null>(null);
  const [absenceStartDate, setAbsenceStartDate] = useState<string>("");
  const [absenceEndDate, setAbsenceEndDate] = useState<string>("");

  // Initialize selectedRecipients from message when editing
  useEffect(() => {
    if (message?.recipients && Array.isArray(message.recipients)) {
      setSelectedRecipients(message.recipients);
    }
  }, [message]);


  const sendEmailMutation = useMutation({
    mutationFn: async (data: { recipients: string[], subject: string, message: string }) => {
      return apiRequest("POST", "/api/send-email", data);
    },
    onSuccess: (response) => {
      toast({
        title: "Email Sent Successfully",
        description: `Sent to ${response.sentCount} recipients`,
      });
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send email",
        variant: "destructive",
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: MessageFormData) => {
      const finalData = {
        ...data,
        authorId: 6,
        status: sendOption === "now" ? "sent" : sendOption === "schedule" ? "scheduled" : "draft",
        sendDate: sendOption === "now" 
          ? new Date().toISOString() 
          : sendOption === "schedule" && scheduleDate && scheduleTime
            ? new Date(`${scheduleDate}T${scheduleTime}`).toISOString()
            : null,
      };
      return apiRequest("POST", "/api/communications", finalData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/communications"] });
      toast({
        title: "Success",
        description: sendOption === "now" 
          ? "Message sent successfully" 
          : sendOption === "schedule" 
            ? "Message scheduled successfully"
            : "Message saved as draft",
      });
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create message",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: MessageFormData) => apiRequest("PUT", `/api/communications/${message!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/communications"] });
      toast({
        title: "Success",
        description: "Message updated successfully",
      });
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update message",
        variant: "destructive",
      });
    },
  });

  const handleSendNow = () => {
    const formData = form.getValues();
    if (!formData.subject || !formData.message) {
      toast({
        title: "Validation Error",
        description: "Please fill in subject and message before sending",
        variant: "destructive",
      });
      return;
    }
    
    if (selectedRecipients.length === 0) {
      toast({
        title: "No Recipients",
        description: "Please select at least one recipient group",
        variant: "destructive",
      });
      return;
    }
    
    setSendOption("now");
    
    const recipientEmails = getRecipientEmails(selectedRecipients);
    if (recipientEmails.length > 0) {
      sendEmailMutation.mutate({
        recipients: recipientEmails,
        subject: formData.subject,
        message: formData.message
      });
    }
    
    const finalData = {
      ...formData,
      recipients: selectedRecipients,
      status: "sent" as const,
      sendDate: new Date().toISOString(),
    };
    
    createMutation.mutate(finalData);
  };

  const handleSchedule = () => {
    const formData = form.getValues();
    if (!formData.subject || !formData.message) {
      toast({
        title: "Validation Error",
        description: "Please fill in subject and message before scheduling",
        variant: "destructive",
      });
      return;
    }
    
    if (selectedRecipients.length === 0) {
      toast({
        title: "No Recipients",
        description: "Please select at least one recipient group",
        variant: "destructive",
      });
      return;
    }
    
    setShowScheduleModal(true);
  };

  const confirmSchedule = () => {
    if (!scheduleDate || !scheduleTime) {
      toast({
        title: "Missing Schedule Time",
        description: "Please select both date and time",
        variant: "destructive",
      });
      return;
    }
    
    const formData = form.getValues();
    const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime}`);
    
    if (scheduledDateTime <= new Date()) {
      toast({
        title: "Invalid Date",
        description: "Scheduled time must be in the future",
        variant: "destructive",
      });
      return;
    }
    
    const finalData = {
      ...formData,
      recipients: selectedRecipients,
      status: "scheduled" as const,
      sendDate: scheduledDateTime.toISOString(),
    };
    
    createMutation.mutate(finalData);
    setShowScheduleModal(false);
  };

  const onSubmit = (data: MessageFormData) => {
    const finalData = {
      ...data,
      recipients: selectedRecipients
    };

    if (isEditing) {
      updateMutation.mutate(finalData);
    } else {
      const draftData = {
        ...finalData,
        status: "draft" as const,
      };
      createMutation.mutate(draftData);
    }
  };

  // Helper function to get affected students during instructor absence
  const getAffectedStudentsByAbsence = (instructorId: number, startDate: string, endDate: string): Student[] => {
    if (!startDate || !endDate) return [];
    
    // Find classes taught by this instructor during the absence period
    const affectedClasses = classes.filter(cls => {
      if (cls.instructorId !== instructorId) return false;
      
      const classDate = new Date(cls.date);
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      return classDate >= start && classDate <= end && cls.status === 'scheduled';
    });
    
    // Get students who actually have scheduled classes during this period
    const affectedStudentIds = new Set<number>();
    
    affectedClasses.forEach(cls => {
      const eligibleStudents = students.filter(student => {
        const isAssignedToInstructor = student.instructorId === instructorId || student.favoriteInstructorId === instructorId;
        const matchesCourseType = student.courseType === cls.courseType;
        const isActiveStudent = student.phase && !student.phase.includes('Completed') && !student.phase.includes('Graduated');
        
        const isTheoryClass = cls.classNumber <= 12;
        const isInCarClass = !isTheoryClass;
        
        if (isTheoryClass) {
          const matchesTheoryLevel = student.currentTheoryClass === cls.classNumber;
          return isAssignedToInstructor && matchesCourseType && isActiveStudent && matchesTheoryLevel;
        }
        
        if (isInCarClass) {
          const matchesInCarLevel = student.currentInCarSession === cls.classNumber;
          return isAssignedToInstructor && matchesCourseType && isActiveStudent && matchesInCarLevel;
        }
        
        return isAssignedToInstructor && matchesCourseType && isActiveStudent;
      });
      
      eligibleStudents.forEach(student => affectedStudentIds.add(student.id));
    });
    
    return students.filter(s => affectedStudentIds.has(s.id));
  };

  const getRecipientEmails = (recipients: string[]): string[] => {
    const emails: string[] = [];
    
    recipients.forEach(recipient => {
      if (recipient === 'all-students') {
        emails.push(...students.filter(s => s.email).map(s => s.email!));
      } else if (recipient === 'all-instructors') {
        emails.push(...instructors.filter(i => i.email).map(i => i.email!));
      } else if (recipient === 'auto-students') {
        emails.push(...students.filter(s => s.courseType === 'auto' && s.email).map(s => s.email!));
      } else if (recipient === 'moto-students') {
        emails.push(...students.filter(s => s.courseType === 'moto' && s.email).map(s => s.email!));
      } else if (recipient === 'scooter-students') {
        emails.push(...students.filter(s => s.courseType === 'scooter' && s.email).map(s => s.email!));
      } else if (recipient.startsWith('theory-class-')) {
        const classNumber = parseInt(recipient.replace('theory-class-', ''));
        emails.push(...students.filter(s => s.currentTheoryClass === classNumber && s.email).map(s => s.email!));
      } else if (recipient.startsWith('in-car-session-')) {
        const sessionNumber = parseInt(recipient.replace('in-car-session-', ''));
        emails.push(...students.filter(s => s.currentInCarSession === sessionNumber && s.email).map(s => s.email!));
      } else if (recipient.startsWith('class-')) {
        const classId = parseInt(recipient.replace('class-', ''));
        const classInfo = classes.find(c => c.id === classId);
        if (classInfo) {
          emails.push(...students.filter(s => s.courseType === classInfo.courseType && s.email).map(s => s.email!));
        }
      } else if (recipient.startsWith('phase-')) {
        const phase = recipient.replace('phase-', '');
        emails.push(...students.filter(s => s.phase === phase && s.email).map(s => s.email!));
      } else if (recipient.startsWith('instructor-')) {
        const instructorId = parseInt(recipient.replace('instructor-', ''));
        emails.push(...students.filter(s => (s.instructorId === instructorId || s.favoriteInstructorId === instructorId) && s.email).map(s => s.email!));
      } else if (recipient.startsWith('instructor-absence::')) {
        const parts = recipient.replace('instructor-absence::', '').split('::');
        if (parts.length >= 3) {
          const instructorId = parseInt(parts[0]);
          const startDate = parts[1];
          const endDate = parts[2];
          
          if (!isNaN(instructorId) && startDate && endDate) {
            const affectedStudents = getAffectedStudentsByAbsence(instructorId, startDate, endDate);
            emails.push(...affectedStudents.filter(s => s.email).map(s => s.email!));
          }
        }
      }
    });
    
    return Array.from(new Set(emails));
  };

  const recipientEmails = getRecipientEmails(selectedRecipients);
  const totalRecipients = recipientEmails.length;

  const getRecipientGroupLabel = (recipient: string): string => {
    if (recipient === 'all-students') return 'All Students';
    if (recipient === 'all-instructors') return 'All Instructors';
    if (recipient === 'auto-students') return 'Auto Students';
    if (recipient === 'moto-students') return 'Moto Students';
    if (recipient === 'scooter-students') return 'Scooter Students';
    if (recipient.startsWith('theory-class-')) {
      const num = recipient.replace('theory-class-', '');
      return `Theory Class #${num}`;
    }
    if (recipient.startsWith('in-car-session-')) {
      const num = recipient.replace('in-car-session-', '');
      return `In-Car Session #${num}`;
    }
    if (recipient.startsWith('phase-')) {
      return recipient.replace('phase-', '');
    }
    if (recipient.startsWith('class-')) {
      const classId = parseInt(recipient.replace('class-', ''));
      const cls = classes.find(c => c.id === classId);
      return cls ? `${cls.courseType.toUpperCase()} Class #${cls.classNumber}` : `Class ${classId}`;
    }
    if (recipient.startsWith('instructor-absence::')) {
      const parts = recipient.replace('instructor-absence::', '').split('::');
      if (parts.length >= 3) {
        const instructorId = parseInt(parts[0]);
        const instructor = instructors.find(i => i.id === instructorId);
        return instructor ? `Affected by ${instructor.firstName} ${instructor.lastName}'s absence` : 'Instructor Absence';
      }
    }
    if (recipient.startsWith('instructor-')) {
      const instructorId = parseInt(recipient.replace('instructor-', ''));
      const instructor = instructors.find(i => i.id === instructorId);
      return instructor ? `Students of ${instructor.firstName} ${instructor.lastName}` : `Instructor ${instructorId}`;
    }
    return recipient;
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Recipient Summary Card */}
        {selectedRecipients.length > 0 && (
          <Card className="border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600" />
                Recipient Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-white rounded-lg border-2 border-blue-200">
                <div>
                  <p className="text-sm text-gray-600">Total Recipients</p>
                  <p className="text-3xl font-bold text-blue-600">{totalRecipients}</p>
                  <p className="text-xs text-gray-500 mt-1">{selectedRecipients.length} group{selectedRecipients.length !== 1 ? 's' : ''} selected</p>
                </div>
                <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full p-4">
                  <Mail className="h-8 w-8 text-white" />
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Selected Groups:</p>
                <div className="flex flex-wrap gap-2">
                  {selectedRecipients.map(recipient => (
                    <Badge key={recipient} className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-300">
                      {getRecipientGroupLabel(recipient)}
                    </Badge>
                  ))}
                </div>
              </div>

              <Collapsible open={showEmailPreview} onOpenChange={setShowEmailPreview}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full" type="button">
                    <Eye className="h-4 w-4 mr-2" />
                    {showEmailPreview ? 'Hide' : 'Preview'} Email Addresses ({totalRecipients})
                    <ChevronDown className={`h-4 w-4 ml-2 transition-transform ${showEmailPreview ? 'rotate-180' : ''}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3">
                  <div className="max-h-48 overflow-y-auto p-3 bg-white rounded-lg border">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {recipientEmails.map((email, index) => (
                        <div key={index} className="text-sm text-gray-700 flex items-center gap-2">
                          <Mail className="h-3 w-3 text-gray-400" />
                          {email}
                        </div>
                      ))}
                    </div>
                    {recipientEmails.length === 0 && (
                      <p className="text-sm text-gray-500 text-center py-4">
                        No email addresses found for selected groups
                      </p>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        )}

        <div>
          <FormLabel className="text-base font-semibold">Recipients</FormLabel>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Select who should receive this message
          </p>
          
          <Tabs value={recipientTab} onValueChange={setRecipientTab} className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="course-types" className="flex items-center gap-1 text-xs">
                <Users className="h-3 w-3" />
                Course Types
              </TabsTrigger>
              <TabsTrigger value="theory-classes" className="flex items-center gap-1 text-xs">
                <GraduationCap className="h-3 w-3" />
                Theory Classes
              </TabsTrigger>
              <TabsTrigger value="in-car-sessions" className="flex items-center gap-1 text-xs">
                <Calendar className="h-3 w-3" />
                In-Car Sessions
              </TabsTrigger>
              <TabsTrigger value="phases" className="flex items-center gap-1 text-xs">
                <GraduationCap className="h-3 w-3" />
                Phases
              </TabsTrigger>
              <TabsTrigger value="classes" className="flex items-center gap-1 text-xs">
                <Calendar className="h-3 w-3" />
                Classes
              </TabsTrigger>
              <TabsTrigger value="instructors" className="flex items-center gap-1 text-xs">
                <User className="h-3 w-3" />
                Instructors
              </TabsTrigger>
            </TabsList>

            <TabsContent value="course-types" className="mt-4">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Course Type Recipients</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'all-students', label: 'All Students', count: students.length },
                    { id: 'auto-students', label: 'Auto Students', count: students.filter(s => s.courseType === 'auto').length },
                    { id: 'moto-students', label: 'Moto Students', count: students.filter(s => s.courseType === 'moto').length },
                    { id: 'scooter-students', label: 'Scooter Students', count: students.filter(s => s.courseType === 'scooter').length }
                  ].map(option => (
                    <label key={option.id} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                      <Checkbox
                        checked={selectedRecipients.includes(option.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedRecipients([...selectedRecipients, option.id]);
                          } else {
                            setSelectedRecipients(selectedRecipients.filter(r => r !== option.id));
                          }
                        }}
                      />
                      <div className="flex-1">
                        <div className="font-medium text-sm">{option.label}</div>
                        <Badge variant="secondary" className="text-xs">{option.count} recipients</Badge>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="theory-classes" className="mt-4">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Theory Class Recipients</h4>
                <p className="text-xs text-gray-600 dark:text-gray-400">Select students currently in specific theory classes (1-12)</p>
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(classNumber => {
                    const studentsInClass = students.filter(s => s.currentTheoryClass === classNumber);
                    const optionId = `theory-class-${classNumber}`;
                    return (
                      <label key={classNumber} className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                        <Checkbox
                          checked={selectedRecipients.includes(optionId)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedRecipients([...selectedRecipients, optionId]);
                            } else {
                              setSelectedRecipients(selectedRecipients.filter(r => r !== optionId));
                            }
                          }}
                        />
                        <div className="flex-1">
                          <div className="font-medium text-sm">Theory #{classNumber}</div>
                          <Badge variant="secondary" className="text-xs">{studentsInClass.length} students</Badge>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="in-car-sessions" className="mt-4">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">In-Car Session Recipients</h4>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Select students currently in specific in-car sessions (1-15). Note: Sessions #12-13 are 2-hour classes.
                </p>
                <div className="grid grid-cols-5 gap-2">
                  {Array.from({ length: 15 }, (_, i) => i + 1).map(sessionNumber => {
                    const studentsInSession = students.filter(s => s.currentInCarSession === sessionNumber);
                    const optionId = `in-car-session-${sessionNumber}`;
                    const isSpecialSession = sessionNumber === 12 || sessionNumber === 13;
                    return (
                      <label key={sessionNumber} className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                        <Checkbox
                          checked={selectedRecipients.includes(optionId)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedRecipients([...selectedRecipients, optionId]);
                            } else {
                              setSelectedRecipients(selectedRecipients.filter(r => r !== optionId));
                            }
                          }}
                        />
                        <div className="flex-1">
                          <div className="font-medium text-sm">
                            Session #{sessionNumber}
                            {isSpecialSession && <span className="text-xs text-orange-600 ml-1">(2hr)</span>}
                          </div>
                          <Badge variant="secondary" className="text-xs">{studentsInSession.length} students</Badge>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="phases" className="mt-4">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Phase-based Recipients</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'phase-Auto Phase 2', label: 'Auto Phase 2', count: students.filter(s => s.phase === 'Auto Phase 2').length },
                    { id: 'phase-Auto Phase 3', label: 'Auto Phase 3', count: students.filter(s => s.phase === 'Auto Phase 3').length },
                    { id: 'phase-Auto Phase 4', label: 'Auto Phase 4', count: students.filter(s => s.phase === 'Auto Phase 4').length },
                    { id: 'phase-Moto Phase 2', label: 'Moto Phase 2', count: students.filter(s => s.phase === 'Moto Phase 2').length },
                    { id: 'phase-Moto Phase 3', label: 'Moto Phase 3', count: students.filter(s => s.phase === 'Moto Phase 3').length },
                    { id: 'phase-Moto Phase 4', label: 'Moto Phase 4', count: students.filter(s => s.phase === 'Moto Phase 4').length },
                    { id: 'phase-Scooter Phase 2', label: 'Scooter Phase 2', count: students.filter(s => s.phase === 'Scooter Phase 2').length },
                    { id: 'phase-Scooter Phase 3', label: 'Scooter Phase 3', count: students.filter(s => s.phase === 'Scooter Phase 3').length },
                    { id: 'phase-Scooter Phase 4', label: 'Scooter Phase 4', count: students.filter(s => s.phase === 'Scooter Phase 4').length }
                  ].map(option => (
                    <label key={option.id} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                      <Checkbox
                        checked={selectedRecipients.includes(option.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedRecipients([...selectedRecipients, option.id]);
                          } else {
                            setSelectedRecipients(selectedRecipients.filter(r => r !== option.id));
                          }
                        }}
                      />
                      <div className="flex-1">
                        <div className="font-medium text-sm">{option.label}</div>
                        <Badge variant="secondary" className="text-xs">{option.count} recipients</Badge>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="classes" className="mt-4">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Class-specific Recipients</h4>
                <div className="space-y-2">
                  {classes.slice(0, 6).map(cls => {
                    const enrollmentCount = Math.floor(Math.random() * 15) + 5;
                    const optionId = `class-${cls.id}`;
                    return (
                      <label key={cls.id} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                        <Checkbox
                          checked={selectedRecipients.includes(optionId)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedRecipients([...selectedRecipients, optionId]);
                            } else {
                              setSelectedRecipients(selectedRecipients.filter(r => r !== optionId));
                            }
                          }}
                        />
                        <div className="flex-1">
                          <div className="font-medium text-sm">
                            {cls.courseType.toUpperCase()} Class {cls.classNumber}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            {new Date(cls.date).toLocaleDateString()} at {cls.time}
                          </div>
                          <Badge variant="secondary" className="text-xs">{enrollmentCount} students</Badge>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="instructors" className="mt-4">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-sm flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    Timeline-Based Instructor Messaging
                  </h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Select an instructor and absence period to message only affected students
                  </p>
                </div>

                {/* Instructor Selection */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select Instructor</label>
                  <Select 
                    value={selectedInstructorId?.toString() || ""} 
                    onValueChange={(value) => setSelectedInstructorId(value ? parseInt(value) : null)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose instructor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {instructors.map(instructor => {
                        const specializations = instructor.specializations && typeof instructor.specializations === 'object' 
                          ? Object.keys(instructor.specializations).join(', ')
                          : '';
                        return (
                          <SelectItem key={instructor.id} value={instructor.id.toString()}>
                            {instructor.firstName} {instructor.lastName}
                            {specializations && ` (${specializations})`}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Date Range Selection */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Absence Start Date</label>
                    <Input
                      type="date"
                      value={absenceStartDate}
                      onChange={(e) => setAbsenceStartDate(e.target.value)}
                      min={format(new Date(), 'yyyy-MM-dd')}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Absence End Date</label>
                    <Input
                      type="date"
                      value={absenceEndDate}
                      onChange={(e) => setAbsenceEndDate(e.target.value)}
                      min={absenceStartDate || format(new Date(), 'yyyy-MM-dd')}
                    />
                  </div>
                </div>

                {/* Affected Students Preview */}
                {selectedInstructorId && absenceStartDate && absenceEndDate && (
                  <div className="space-y-3">
                    {(() => {
                      const selectedInstructor = instructors.find(i => i.id === selectedInstructorId);
                      const affectedStudents = getAffectedStudentsByAbsence(selectedInstructorId, absenceStartDate, absenceEndDate);
                      const affectedClasses = classes.filter(cls => {
                        if (cls.instructorId !== selectedInstructorId) return false;
                        const classDate = new Date(cls.date);
                        const start = new Date(absenceStartDate);
                        const end = new Date(absenceEndDate);
                        return classDate >= start && classDate <= end && cls.status === 'scheduled';
                      });

                      return (
                        <>
                          <Alert>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>
                              <strong>{selectedInstructor?.firstName} {selectedInstructor?.lastName}</strong> has {affectedClasses.length} scheduled classes 
                              from {format(new Date(absenceStartDate), 'MMM dd')} to {format(new Date(absenceEndDate), 'MMM dd')}, 
                              affecting <strong>{affectedStudents.length} students</strong>.
                            </AlertDescription>
                          </Alert>

                          {affectedStudents.length > 0 && (
                            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                              <div className="flex items-center justify-between mb-2">
                                <h5 className="font-medium text-sm text-blue-900 dark:text-blue-100">
                                  Affected Students ({affectedStudents.length})
                                </h5>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const optionId = `instructor-absence::${selectedInstructorId}::${absenceStartDate}::${absenceEndDate}`;
                                    if (selectedRecipients.includes(optionId)) {
                                      setSelectedRecipients(selectedRecipients.filter(r => r !== optionId));
                                    } else {
                                      const filteredRecipients = selectedRecipients.filter(recipient => {
                                        if (!recipient.startsWith('instructor-absence::')) return true;
                                        const parts = recipient.replace('instructor-absence::', '').split('::');
                                        const tokenInstructorId = parseInt(parts[0]);
                                        return tokenInstructorId !== selectedInstructorId;
                                      });
                                      setSelectedRecipients([...filteredRecipients, optionId]);
                                    }
                                  }}
                                  className={selectedRecipients.includes(`instructor-absence::${selectedInstructorId}::${absenceStartDate}::${absenceEndDate}`) 
                                    ? "bg-blue-100 border-blue-300" : ""}
                                >
                                  {selectedRecipients.includes(`instructor-absence::${selectedInstructorId}::${absenceStartDate}::${absenceEndDate}`) 
                                    ? "Selected" : "Select All"}
                                </Button>
                              </div>
                              
                              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                                {affectedStudents.map(student => (
                                  <div key={student.id} className="text-xs text-blue-800 dark:text-blue-200">
                                    {student.firstName} {student.lastName}
                                    <span className="text-blue-600 dark:text-blue-300 ml-1">
                                      ({student.courseType?.toUpperCase()})
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {affectedStudents.length === 0 && (
                            <Alert>
                              <Clock className="h-4 w-4" />
                              <AlertDescription>
                                No students will be affected by this instructor's absence during the selected period.
                              </AlertDescription>
                            </Alert>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Traditional Instructor Selection (fallback) */}
                <div className="mt-6 pt-4 border-t">
                  <h5 className="font-medium text-sm mb-3">Alternative: All Students by Instructor</h5>
                  <div className="space-y-3">
                    <Select 
                      onValueChange={(value) => {
                        const optionId = `instructor-${value}`;
                        if (!selectedRecipients.includes(optionId)) {
                          setSelectedRecipients([...selectedRecipients, optionId]);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select instructor to add all their students..." />
                      </SelectTrigger>
                      <SelectContent>
                        {instructors.map(instructor => {
                          const studentsWithInstructor = students.filter(s => s.instructorId === instructor.id || s.favoriteInstructorId === instructor.id);
                          const optionId = `instructor-${instructor.id}`;
                          const isAlreadySelected = selectedRecipients.includes(optionId);
                          const specializations = instructor.specializations && typeof instructor.specializations === 'object' 
                            ? Object.keys(instructor.specializations).join(', ') 
                            : 'No specialization listed';
                          
                          return (
                            <SelectItem 
                              key={instructor.id} 
                              value={instructor.id.toString()}
                              disabled={isAlreadySelected}
                            >
                              <div className="flex flex-col">
                                <div className="font-medium">
                                  {instructor.firstName} {instructor.lastName}
                                  {isAlreadySelected && <span className="text-green-600 ml-2">✓ Selected</span>}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {specializations} • {studentsWithInstructor.length} students
                                </div>
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    
                    {/* Show selected instructors */}
                    {(() => {
                      const selectedInstructorIds = selectedRecipients
                        .filter(r => r.startsWith('instructor-'))
                        .map(r => parseInt(r.replace('instructor-', '')));
                      
                      if (selectedInstructorIds.length === 0) return null;
                      
                      return (
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Selected Instructors ({selectedInstructorIds.length})
                          </p>
                          <div className="grid gap-2">
                            {selectedInstructorIds.map(instructorId => {
                              const instructor = instructors.find(i => i.id === instructorId);
                              if (!instructor) return null;
                              
                              const studentsWithInstructor = students.filter(s => s.instructorId === instructor.id || s.favoriteInstructorId === instructor.id);
                              const optionId = `instructor-${instructor.id}`;
                              
                              return (
                                <div key={instructor.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border">
                                  <div className="flex-1">
                                    <div className="font-medium text-sm">
                                      {instructor.firstName} {instructor.lastName}
                                    </div>
                                    <div className="text-xs text-gray-600 dark:text-gray-400">
                                      {instructor.specializations && typeof instructor.specializations === 'object' 
                                        ? Object.keys(instructor.specializations).join(', ') 
                                        : 'No specialization listed'}
                                    </div>
                                    <Badge variant="secondary" className="text-xs mt-1">{studentsWithInstructor.length} students</Badge>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost" 
                                    size="sm"
                                    onClick={() => {
                                      setSelectedRecipients(selectedRecipients.filter(r => r !== optionId));
                                    }}
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                                  >
                                    Remove
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </TabsContent>

          </Tabs>
        </div>

        <FormField
          control={form.control}
          name="messageType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Message Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select message type..." />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="announcement">Announcement</SelectItem>
                  <SelectItem value="reminder">Reminder</SelectItem>
                  <SelectItem value="schedule-change">Schedule Change</SelectItem>
                  <SelectItem value="payment-notice">Payment Notice</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="subject"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subject</FormLabel>
              <FormControl>
                <Input placeholder="Enter message subject..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Message</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Enter your message..."
                  className="min-h-[120px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {selectedRecipients.length === 0 && (
          <Alert className="border-orange-200 bg-orange-50">
            <AlertTriangle className="h-4 w-4 text-orange-600" />
            <AlertDescription className="text-orange-800">
              Please select at least one recipient group before saving or sending this message.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-3 pt-4 flex-wrap">
          <Button 
            type="button"
            onClick={handleSendNow}
            disabled={
              createMutation.isPending || 
              updateMutation.isPending || 
              sendEmailMutation.isPending || 
              selectedRecipients.length === 0
            }
            className="bg-[#ECC462] hover:bg-[#d4af50] text-black font-semibold"
            data-testid="button-send-now"
          >
            {sendEmailMutation.isPending ? (
              <>
                <Clock className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Now ({totalRecipients} recipients)
              </>
            )}
          </Button>

          <Button 
            type="button"
            onClick={handleSchedule}
            disabled={
              createMutation.isPending || 
              updateMutation.isPending || 
              sendEmailMutation.isPending || 
              selectedRecipients.length === 0
            }
            variant="outline"
            className="border-[#ECC462] text-[#ECC462] hover:bg-[#ECC462] hover:text-black"
            data-testid="button-schedule"
          >
            <Clock className="h-4 w-4 mr-2" />
            Schedule
          </Button>

          <Button 
            type="submit"
            disabled={
              createMutation.isPending || 
              updateMutation.isPending
            }
            variant="outline"
            data-testid="button-save-draft"
          >
            {createMutation.isPending || updateMutation.isPending ? (
              <>
                <Clock className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {isEditing ? "Update Draft" : "Save as Draft"}
              </>
            )}
          </Button>

          <Button type="button" variant="ghost" onClick={onSuccess}>
            Cancel
          </Button>
        </div>

        {/* Schedule Modal */}
        <Dialog open={showScheduleModal} onOpenChange={setShowScheduleModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-[#ECC462]" />
                Schedule Message
              </DialogTitle>
              <DialogDescription>
                Choose when you want this message to be sent to {totalRecipients} recipients
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Date</label>
                <Input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  data-testid="input-schedule-date"
                />
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Time</label>
                <Input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  data-testid="input-schedule-time"
                />
              </div>

              {scheduleDate && scheduleTime && (
                <Alert className="border-[#ECC462] bg-yellow-50">
                  <Info className="h-4 w-4 text-[#ECC462]" />
                  <AlertDescription className="text-sm">
                    Message will be sent on <strong>{format(new Date(`${scheduleDate}T${scheduleTime}`), 'MMM dd, yyyy')} at {scheduleTime}</strong>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setShowScheduleModal(false)}
              >
                Cancel
              </Button>
              <Button 
                onClick={confirmSchedule}
                disabled={!scheduleDate || !scheduleTime || createMutation.isPending}
                className="bg-[#ECC462] hover:bg-[#d4af50] text-black"
                data-testid="button-confirm-schedule"
              >
                {createMutation.isPending ? (
                  <>
                    <Clock className="h-4 w-4 mr-2 animate-spin" />
                    Scheduling...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Confirm Schedule
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </form>
    </Form>
  );
}
