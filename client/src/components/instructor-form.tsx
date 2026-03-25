import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, MapPin, Calendar, Phone, FileText, Loader2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertInstructorSchema, type Instructor, type Location, type Vehicle } from "@shared/schema";
import { z } from "zod";

// Enhanced instructor form schema with comprehensive validation
const instructorFormSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100, "First name is too long"),
  lastName: z.string().min(1, "Last name is required").max(100, "Last name is too long"),
  email: z.string()
    .min(1, "Email is required")
    .email("Please enter a valid email address (e.g., instructor@example.com)"),
  phone: z.string().optional().refine((val) => {
    if (!val || val.length === 0) return true;
    const phoneRegex = /^[\d\s\-\(\)\+\.]+$/;
    return phoneRegex.test(val) && val.replace(/\D/g, '').length >= 10;
  }, "Please enter a valid phone number with at least 10 digits"),
  instructorLicenseNumber: z.string().optional(),
  permitNumber: z.string().optional(),
  locationAssignment: z.string().optional(),
  secondaryLocations: z.array(z.string()).optional().default([]),
  hireDate: z.string().optional(),
  certificationExpiry: z.string().optional(),
  emergencyContact: z.string().optional(),
  emergencyPhone: z.string().optional().refine((val) => {
    if (!val || val.length === 0) return true;
    const phoneRegex = /^[\d\s\-\(\)\+\.]+$/;
    return phoneRegex.test(val) && val.replace(/\D/g, '').length >= 10;
  }, "Please enter a valid emergency phone number with at least 10 digits"),
  notes: z.string().optional(),
  status: z.string().default("active"),
  vehicleId: z.number().optional(),
  specializationsData: z.record(z.object({
    theory: z.boolean(),
    practical: z.boolean(),
  })).default({}),
});

type InstructorFormData = z.infer<typeof instructorFormSchema>;

interface InstructorFormProps {
  instructor?: Instructor;
  onSuccess: () => void;
}

// Remove hardcoded locations - we'll fetch from database

const courseTypes = [
  { value: "auto", label: "Automobile" },
  { value: "moto", label: "Motorcycle" },
  { value: "scooter", label: "Scooter" }
];

export default function InstructorForm({ instructor, onSuccess }: InstructorFormProps) {
  const { toast } = useToast();
  const isEditing = !!instructor;
  const [newSecondaryLocation, setNewSecondaryLocation] = useState("");

  // Fetch locations from database
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  // Fetch vehicles from database
  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
  });

  // Parse existing specializations from database
  const parseSpecializations = (specializations: any) => {
    if (typeof specializations === 'string') {
      try {
        return JSON.parse(specializations);
      } catch {
        return {};
      }
    }
    return specializations || {};
  };

  // Parse secondary locations
  const parseSecondaryLocations = (locations: any) => {
    if (typeof locations === 'string') {
      try {
        return JSON.parse(locations);
      } catch {
        return [];
      }
    }
    return Array.isArray(locations) ? locations : [];
  };

  const form = useForm<InstructorFormData>({
    resolver: zodResolver(instructorFormSchema),
    defaultValues: {
      firstName: instructor?.firstName || "",
      lastName: instructor?.lastName || "",
      email: instructor?.email || "",
      phone: instructor?.phone || "",
      instructorLicenseNumber: instructor?.instructorLicenseNumber || "",
      permitNumber: instructor?.permitNumber || "",
      locationAssignment: instructor?.locationAssignment || "",
      secondaryLocations: instructor ? parseSecondaryLocations(instructor.secondaryLocations) : [],
      hireDate: instructor?.hireDate || "",
      certificationExpiry: instructor?.certificationExpiry || "",
      emergencyContact: instructor?.emergencyContact || "",
      emergencyPhone: instructor?.emergencyPhone || "",
      notes: instructor?.notes || "",
      status: instructor?.status || "active",
      vehicleId: instructor?.vehicleId || undefined,
      specializationsData: instructor ? parseSpecializations(instructor.specializations) : {},
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InstructorFormData) => {
      console.log('Form data:', data);
      const submitData = {
        ...data,
        specializations: Object.keys(data.specializationsData || {}).length > 0 
          ? JSON.stringify(data.specializationsData) 
          : null,
        secondaryLocations: JSON.stringify(data.secondaryLocations || []),
      };
      delete (submitData as any).specializationsData;
      console.log('Submit data:', submitData);
      
      return isEditing 
        ? apiRequest('PUT', `/api/instructors/${instructor!.id}`, submitData)
        : apiRequest('POST', '/api/instructors', submitData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instructors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructors", instructor?.id] });
      toast({
        title: "✓ Success",
        description: `Instructor ${isEditing ? 'updated' : 'created'} successfully`,
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0"
      });
      form.reset();
      onSuccess();
    },
    onError: (error: any) => {
      console.error('Instructor form error:', error);
      
      let errorTitle = "Error";
      let errorMessage = `Failed to ${isEditing ? 'update' : 'create'} instructor`;
      
      if (error?.data?.message) {
        const message = error.data.message.toLowerCase();
        
        // Handle duplicate errors gracefully
        if (message.includes("duplicate") || message.includes("already exists") || message.includes("unique")) {
          errorTitle = "Duplicate Instructor";
          if (message.includes("email")) {
            errorMessage = "An instructor with this email address already exists. Please use a different email.";
          } else if (message.includes("license") || message.includes("instructorlicensenumber")) {
            errorMessage = "An instructor with this license number already exists. Please check the license number.";
          } else if (message.includes("permit")) {
            errorMessage = "An instructor with this permit number already exists. Please check the permit number.";
          } else {
            errorMessage = "This instructor already exists in the system. Please check the email, license number, or permit number.";
          }
        } else {
          errorMessage = error.data.message;
        }
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      // If there are field-specific errors, show them
      if (error?.data?.errors && Array.isArray(error.data.errors)) {
        const fieldErrors = error.data.errors.map((err: any) => {
          return `${err.path?.join('.')}: ${err.message}`;
        }).join(', ');
        errorMessage = fieldErrors;
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InstructorFormData) => {
    createMutation.mutate(data);
  };

  const toggleSpecialization = (courseType: string, type: 'theory' | 'practical') => {
    console.log(`toggleSpecialization called: ${courseType}, ${type}`);
    const current = form.getValues('specializationsData');
    console.log('Current specializations:', current);
    const updated = {
      ...current,
      [courseType]: {
        ...current[courseType],
        [type]: !current[courseType]?.[type]
      }
    };
    
    // Remove course type if both theory and practical are false
    if (!updated[courseType].theory && !updated[courseType].practical) {
      delete updated[courseType];
    }
    
    console.log('Updated specializations:', updated);
    form.setValue('specializationsData', updated);
    console.log('Form value after setValue:', form.getValues('specializationsData'));
  };

  const addSecondaryLocation = () => {
    if (newSecondaryLocation && !form.getValues('secondaryLocations').includes(newSecondaryLocation)) {
      const current = form.getValues('secondaryLocations');
      form.setValue('secondaryLocations', [...current, newSecondaryLocation]);
      setNewSecondaryLocation("");
    }
  };

  const removeSecondaryLocation = (location: string) => {
    const current = form.getValues('secondaryLocations');
    form.setValue('secondaryLocations', current.filter(loc => loc !== location));
  };

  const specializationsData = form.watch('specializationsData');
  const secondaryLocations = form.watch('secondaryLocations');
  const isLoading = createMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Personal Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Personal Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="John" data-testid="input-first-name" />
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
                      <Input {...field} placeholder="Smith" data-testid="input-last-name" />
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
                      <Input {...field} type="email" placeholder="instructor@mortys.com" data-testid="input-email" />
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
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="(555) 123-4567" data-testid="input-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Professional Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Professional Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="instructorLicenseNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instructor License Number</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="IL-2024-001" data-testid="input-license-number" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="permitNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Government Permit Number</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="GP-123456" data-testid="input-permit-number" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="hireDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hire Date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" data-testid="input-hire-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="certificationExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Certification Expiry</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" data-testid="input-certification-expiry" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-status">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Teaching Specializations */}
        <Card data-testid="specializations-section">
          <CardHeader>
            <CardTitle>Teaching Specializations</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select which courses the instructor can teach and whether they can handle theory, driving, or both
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {courseTypes.map(({ value, label }) => (
                <div key={value} className="flex items-center justify-between p-4 border rounded-lg" data-testid={`specialization-group-${value}`}>
                  <div className="font-medium">{label}</div>
                  <div className="flex gap-4">
                    <label className="flex items-center space-x-2">
                      <Checkbox
                        checked={!!specializationsData[value]?.theory}
                        data-testid={`checkbox-${value}-theory`}
                        onCheckedChange={() => {
                          console.log(`Toggling ${value} theory`);
                          toggleSpecialization(value, 'theory');
                        }}
                      />
                      <span className="text-sm">Theory</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <Checkbox
                        checked={!!specializationsData[value]?.practical}
                        data-testid={`checkbox-${value}-practical`}
                        onCheckedChange={() => {
                          console.log(`Toggling ${value} practical`);
                          toggleSpecialization(value, 'practical');
                        }}
                      />
                      <span className="text-sm">Driving</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium mb-2">Selected Specializations:</p>
              <div className="flex flex-wrap gap-2" data-testid="selected-specializations">
                {Object.entries(specializationsData).map(([courseType, abilities]) => (
                  <Badge key={courseType} variant="secondary" data-testid={`selected-${courseType}`}>
                    {courseTypes.find(c => c.value === courseType)?.label}: 
                    {abilities.theory && " Theory"}
                    {abilities.theory && abilities.practical && ","}
                    {abilities.practical && " Driving"}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Location Assignment */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Location Assignment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="locationAssignment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Primary Location</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-location">
                        <SelectValue placeholder="Select primary location" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {locations.map((location) => (
                        <SelectItem key={location.id} value={location.name}>
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
              name="vehicleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assigned Vehicle</FormLabel>
                  <Select 
                    onValueChange={(value) => field.onChange(value === "none" ? undefined : parseInt(value))} 
                    defaultValue={field.value ? String(field.value) : "none"}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-vehicle">
                        <SelectValue placeholder="Select assigned vehicle" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">No vehicle assigned</SelectItem>
                      {vehicles.map((vehicle) => (
                        <SelectItem key={vehicle.id} value={String(vehicle.id)}>
                          {vehicle.licensePlate} - {vehicle.make} {vehicle.model} ({vehicle.year})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <FormLabel>Secondary Locations</FormLabel>
              <div className="flex gap-2 mt-2">
                <Select value={newSecondaryLocation} onValueChange={setNewSecondaryLocation}>
                  <SelectTrigger className="flex-1" data-testid="select-secondary-location">
                    <SelectValue placeholder="Add secondary location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations
                      .filter(loc => 
                        loc.name !== form.watch('locationAssignment') && 
                        !secondaryLocations.includes(loc.name)
                      )
                      .map((location) => (
                        <SelectItem key={location.id} value={location.name}>
                          {location.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm"
                  onClick={addSecondaryLocation}
                  disabled={!newSecondaryLocation}
                  data-testid="button-add-secondary-location"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {secondaryLocations.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {secondaryLocations.map((location) => (
                    <Badge key={location} variant="outline" className="flex items-center gap-1">
                      {location}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-4 w-4 p-0 hover:bg-transparent"
                        onClick={() => removeSecondaryLocation(location)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Emergency Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Emergency Contact
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="emergencyContact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emergency Contact Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Emergency contact name" data-testid="input-emergency-contact" />
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
                    <FormLabel>Emergency Phone</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="(555) 999-0000" data-testid="input-emergency-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Additional Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      placeholder="Additional information about the instructor..."
                      rows={3}
                      data-testid="textarea-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end space-x-2">
          <Button 
            type="button" 
            variant="outline" 
            onClick={onSuccess}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button 
            type="submit" 
            disabled={isLoading}
            data-testid="button-submit-instructor"
            className="bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111]"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#111111]" />}
            {isLoading 
              ? (isEditing ? "Updating..." : "Creating...") 
              : (isEditing ? "Update Instructor" : "Create Instructor")
            }
          </Button>
        </div>
      </form>
    </Form>
  );
}