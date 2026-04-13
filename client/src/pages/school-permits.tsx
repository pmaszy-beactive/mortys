import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { FileText, Plus, Edit, Trash2, MapPin, Car, Bike, Calendar, AlertTriangle, CheckCircle, Clock, Upload, FileUp, Download, Eye } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SchoolPermit, InsertSchoolPermit, Location } from "@shared/schema";

const schoolPermitSchema = z.object({
  permitCode: z.string().min(1, "Permit code is required"),
  location: z.string().min(1, "Location is required"),
  courseTypes: z.array(z.string()).min(1, "At least one course type is required"),
  startNumber: z.number().min(1, "Start number must be positive"),
  quantity: z.number().min(1, "Quantity must be at least 1"),
  issueDate: z.string().optional(),
  expiryDate: z.string().optional(),
  notes: z.string().optional(),
}).refine((data) => data.quantity > 0, {
  message: "Quantity must be greater than 0",
  path: ["quantity"],
});

// Helper function to get permit expiry status
const getExpiryStatus = (expiryDate: string | null | undefined) => {
  if (!expiryDate) return { status: 'unknown', label: 'No expiry set', color: 'gray' };
  
  const today = new Date();
  const expiry = new Date(expiryDate);
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysUntilExpiry < 0) {
    return { status: 'expired', label: 'Expired', color: 'red', days: Math.abs(daysUntilExpiry) };
  } else if (daysUntilExpiry <= 30) {
    return { status: 'expiring-soon', label: 'Expiring Soon', color: 'orange', days: daysUntilExpiry };
  } else if (daysUntilExpiry <= 90) {
    return { status: 'attention', label: 'Renew Soon', color: 'yellow', days: daysUntilExpiry };
  } else {
    return { status: 'valid', label: 'Valid', color: 'green', days: daysUntilExpiry };
  }
};

type SchoolPermitFormData = z.infer<typeof schoolPermitSchema>;

const courseTypeOptions = [
  { value: "auto", label: "Automobile" },
  { value: "moto-scooter", label: "Motorcycle/Scooter" },
];

export default function SchoolPermitsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPermit, setEditingPermit] = useState<SchoolPermit | null>(null);
  const [editingStartNumber, setEditingStartNumber] = useState(false);
  const { toast } = useToast();

  const { data: permits = [], isLoading } = useQuery<SchoolPermit[]>({
    queryKey: ["/api/school-permits"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const form = useForm<SchoolPermitFormData>({
    resolver: zodResolver(schoolPermitSchema),
    defaultValues: {
      permitCode: "",
      location: "",
      courseTypes: [],
      startNumber: 0,
      quantity: 0,
    },
  });

  const createPermitMutation = useMutation({
    mutationFn: (data: InsertSchoolPermit) =>
      apiRequest("POST", "/api/school-permits", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/school-permits"] });
      setDialogOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "School permit created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create school permit",
        variant: "destructive",
      });
    },
  });

  const updatePermitMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<InsertSchoolPermit> }) =>
      apiRequest("PUT", `/api/school-permits/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/school-permits"] });
      setDialogOpen(false);
      setEditingPermit(null);
      form.reset();
      toast({
        title: "Success",
        description: "School permit updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update school permit",
        variant: "destructive",
      });
    },
  });

  const deletePermitMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/school-permits/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/school-permits"] });
      toast({
        title: "Success",
        description: "School permit deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete school permit",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SchoolPermitFormData) => {
    const endNumber = data.startNumber + data.quantity - 1;
    
    // Convert moto-scooter to separate values for database storage
    let courseTypesForDb = [...data.courseTypes];
    if (courseTypesForDb.includes("moto-scooter")) {
      courseTypesForDb = courseTypesForDb.filter(type => type !== "moto-scooter");
      courseTypesForDb.push("moto", "scooter");
    }
    
    const formattedData = {
      permitCode: data.permitCode,
      location: data.location,
      courseTypes: JSON.stringify(courseTypesForDb),
      startNumber: data.startNumber,
      endNumber: endNumber,
      issueDate: data.issueDate || null,
      expiryDate: data.expiryDate || null,
      notes: data.notes || null,
    };

    if (editingPermit) {
      updatePermitMutation.mutate({ id: editingPermit.id, data: formattedData });
    } else {
      createPermitMutation.mutate(formattedData);
    }
  };

  const handleEdit = (permit: SchoolPermit) => {
    setEditingPermit(permit);
    const currentQuantity = permit.endNumber - permit.startNumber + 1;
    
    // Convert database values to form values
    const dbCourseTypes = JSON.parse(permit.courseTypes);
    let formCourseTypes = [...dbCourseTypes];
    
    // If moto or scooter are present, convert to moto-scooter
    const hasTwoWheel = dbCourseTypes.includes("moto") || dbCourseTypes.includes("scooter");
    if (hasTwoWheel) {
      formCourseTypes = formCourseTypes.filter(type => type !== "moto" && type !== "scooter");
      formCourseTypes.push("moto-scooter");
    }
    
    form.reset({
      permitCode: permit.permitCode,
      location: permit.location,
      courseTypes: formCourseTypes,
      startNumber: permit.startNumber,
      quantity: currentQuantity,
      issueDate: permit.issueDate || '',
      expiryDate: permit.expiryDate || '',
      notes: permit.notes || '',
    });
    setEditingStartNumber(false);
    setDialogOpen(true);
  };

  const handleDelete = (permit: SchoolPermit) => {
    const assigned = permit.totalNumbers - permit.availableNumbers;
    const assignedNote = assigned > 0
      ? ` ${assigned} permit number(s) are currently assigned to students and will also be removed.`
      : "";
    if (confirm(`Are you sure you want to delete permit range ${permit.permitCode} (${permit.startNumber}–${permit.endNumber})?${assignedNote} This cannot be undone.`)) {
      deletePermitMutation.mutate(permit.id);
    }
  };

  const handleOpenDialog = () => {
    setEditingPermit(null);
    setEditingStartNumber(false);
    form.reset();
    setDialogOpen(true);
  };

  // Group permits by location and course type
  const groupedPermits = permits.reduce((acc, permit) => {
    const location = permit.location;
    const courseTypes = JSON.parse(permit.courseTypes);
    
    if (!acc[location]) {
      acc[location] = {
        auto: [],
        moto: []
      };
    }
    
    // Categorize based on course types
    if (courseTypes.includes('auto')) {
      acc[location].auto.push(permit);
    }
    if (courseTypes.includes('moto') || courseTypes.includes('scooter')) {
      acc[location].moto.push(permit);
    }
    
    return acc;
  }, {} as Record<string, { auto: SchoolPermit[], moto: SchoolPermit[] }>);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-amber-50 to-yellow-50">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="animate-pulse space-y-8">
            <div className="h-12 bg-gradient-to-r from-gray-200 to-gray-300 rounded-xl w-1/3"></div>
            <div className="h-64 bg-gradient-to-br from-gray-200 to-gray-300 rounded-2xl"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-amber-50 to-yellow-50">
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">
                  School Permits
                </h1>
                <FileText className="h-8 w-8 text-[#ECC462]" />
              </div>
              <p className="text-lg text-gray-600 font-medium">
                Manage government permit numbers for course completion certificates
              </p>
            </div>
            <Button 
              onClick={handleOpenDialog}
              className="bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg hover:shadow-xl transition-all duration-200"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Permit Range
            </Button>
          </div>


      {/* Permits Grouped by Location and Type */}
      <div className="space-y-6">
        {Object.entries(groupedPermits).map(([location, types]) => (
          <div key={location} className="space-y-4">
            {/* Location Header */}
            <div className="flex items-center gap-2 border-b pb-2">
              <MapPin className="h-5 w-5 text-amber-600" />
              <h2 className="text-xl font-bold bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">{location}</h2>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Auto/Car Section */}
              {types.auto.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Car className="h-4 w-4 text-amber-600" />
                    <h3 className="text-lg font-bold bg-gradient-to-r from-[#ECC462] to-amber-600 bg-clip-text text-transparent">Automobile</h3>
                  </div>
                  <div className="space-y-3">
                    {types.auto.map((permit: SchoolPermit) => (
                      <Card key={permit.id} className="border-0 shadow-lg bg-white/90 backdrop-blur-sm hover:shadow-xl transition-shadow duration-200">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="text-base">{permit.permitCode}</CardTitle>
                              <CardDescription className="text-sm">
                                {permit.startNumber.toLocaleString()} - {permit.endNumber.toLocaleString()}
                              </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={permit.availableNumbers > 0 ? "default" : "destructive"} className="text-xs">
                                {permit.availableNumbers}
                              </Badge>
                              <span className="text-xs text-muted-foreground">available</span>
                            </div>
                          </div>
                          {/* Expiry Status Indicator */}
                          {(() => {
                            const expiryStatus = getExpiryStatus(permit.expiryDate);
                            return (
                              <div className={`mt-2 flex items-center gap-2 text-xs px-2 py-1 rounded-md ${
                                expiryStatus.status === 'expired' ? 'bg-red-100 text-red-700' :
                                expiryStatus.status === 'expiring-soon' ? 'bg-orange-100 text-orange-700' :
                                expiryStatus.status === 'attention' ? 'bg-yellow-100 text-yellow-700' :
                                expiryStatus.status === 'valid' ? 'bg-green-100 text-green-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {expiryStatus.status === 'expired' && <AlertTriangle className="h-3 w-3" />}
                                {expiryStatus.status === 'expiring-soon' && <Clock className="h-3 w-3" />}
                                {expiryStatus.status === 'attention' && <Calendar className="h-3 w-3" />}
                                {expiryStatus.status === 'valid' && <CheckCircle className="h-3 w-3" />}
                                {expiryStatus.status === 'unknown' && <Calendar className="h-3 w-3" />}
                                <span>
                                  {expiryStatus.status === 'unknown' 
                                    ? 'No expiry date set'
                                    : expiryStatus.status === 'expired'
                                      ? `Expired ${expiryStatus.days} days ago`
                                      : `${expiryStatus.label}: ${expiryStatus.days} days left`
                                  }
                                </span>
                              </div>
                            );
                          })()}
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-2">
                            {/* Document indicator */}
                            {permit.documentUrl && (
                              <div className="flex items-center gap-2 text-xs text-blue-600 mb-2">
                                <FileText className="h-3 w-3" />
                                <span>Document attached</span>
                                <a 
                                  href={permit.documentUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline flex items-center gap-1"
                                >
                                  <Eye className="h-3 w-3" />
                                  View
                                </a>
                              </div>
                            )}
                            <div className="w-full bg-gray-200 rounded-full h-1.5">
                              <div 
                                className="bg-gradient-to-r from-[#ECC462] to-amber-500 h-1.5 rounded-full" 
                                style={{ 
                                  width: `${((permit.totalNumbers - permit.availableNumbers) / permit.totalNumbers) * 100}%` 
                                }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{permit.totalNumbers - permit.availableNumbers} of {permit.totalNumbers} assigned</span>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEdit(permit)}
                                  className="h-6 w-6 p-0"
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(permit)}
                                  className="h-6 w-6 p-0"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Moto/Scooter Section */}
              {types.moto.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Bike className="h-4 w-4 text-amber-600" />
                    <h3 className="text-lg font-bold bg-gradient-to-r from-amber-600 to-yellow-700 bg-clip-text text-transparent">Motorcycle/Scooter</h3>
                  </div>
                  <div className="space-y-3">
                    {types.moto.map((permit: SchoolPermit) => (
                      <Card key={permit.id} className="border-0 shadow-lg bg-white/90 backdrop-blur-sm hover:shadow-xl transition-shadow duration-200">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="text-base">{permit.permitCode}</CardTitle>
                              <CardDescription className="text-sm">
                                {permit.startNumber.toLocaleString()} - {permit.endNumber.toLocaleString()}
                              </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={permit.availableNumbers > 0 ? "default" : "destructive"} className="text-xs">
                                {permit.availableNumbers}
                              </Badge>
                              <span className="text-xs text-muted-foreground">available</span>
                            </div>
                          </div>
                          {/* Expiry Status Indicator */}
                          {(() => {
                            const expiryStatus = getExpiryStatus(permit.expiryDate);
                            return (
                              <div className={`mt-2 flex items-center gap-2 text-xs px-2 py-1 rounded-md ${
                                expiryStatus.status === 'expired' ? 'bg-red-100 text-red-700' :
                                expiryStatus.status === 'expiring-soon' ? 'bg-orange-100 text-orange-700' :
                                expiryStatus.status === 'attention' ? 'bg-yellow-100 text-yellow-700' :
                                expiryStatus.status === 'valid' ? 'bg-green-100 text-green-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {expiryStatus.status === 'expired' && <AlertTriangle className="h-3 w-3" />}
                                {expiryStatus.status === 'expiring-soon' && <Clock className="h-3 w-3" />}
                                {expiryStatus.status === 'attention' && <Calendar className="h-3 w-3" />}
                                {expiryStatus.status === 'valid' && <CheckCircle className="h-3 w-3" />}
                                {expiryStatus.status === 'unknown' && <Calendar className="h-3 w-3" />}
                                <span>
                                  {expiryStatus.status === 'unknown' 
                                    ? 'No expiry date set'
                                    : expiryStatus.status === 'expired'
                                      ? `Expired ${expiryStatus.days} days ago`
                                      : `${expiryStatus.label}: ${expiryStatus.days} days left`
                                  }
                                </span>
                              </div>
                            );
                          })()}
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-2">
                            {/* Document indicator */}
                            {permit.documentUrl && (
                              <div className="flex items-center gap-2 text-xs text-blue-600 mb-2">
                                <FileText className="h-3 w-3" />
                                <span>Document attached</span>
                                <a 
                                  href={permit.documentUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline flex items-center gap-1"
                                >
                                  <Eye className="h-3 w-3" />
                                  View
                                </a>
                              </div>
                            )}
                            <div className="flex items-center gap-2 mb-2">
                              {JSON.parse(permit.courseTypes).map((type: string) => {
                                // Map database values to display labels
                                const getDisplayLabel = (courseType: string) => {
                                  switch(courseType) {
                                    case "auto": return "Automobile";
                                    case "moto": return "Motorcycle";
                                    case "scooter": return "Scooter";
                                    default: return courseType;
                                  }
                                };
                                
                                return (
                                  <Badge key={type} variant="secondary" className="text-xs">
                                    {getDisplayLabel(type)}
                                  </Badge>
                                );
                              })}
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-1.5">
                              <div 
                                className="bg-gradient-to-r from-amber-600 to-yellow-700 h-1.5 rounded-full" 
                                style={{ 
                                  width: `${((permit.totalNumbers - permit.availableNumbers) / permit.totalNumbers) * 100}%` 
                                }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{permit.totalNumbers - permit.availableNumbers} of {permit.totalNumbers} assigned</span>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEdit(permit)}
                                  className="h-6 w-6 p-0"
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(permit)}
                                  className="h-6 w-6 p-0"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            {/* Empty state for location */}
            {types.auto.length === 0 && types.moto.length === 0 && (
              <Card className="text-center py-8">
                <CardContent>
                  <p className="text-muted-foreground">No permits available for this location</p>
                </CardContent>
              </Card>
            )}
          </div>
        ))}
        
        {/* Empty state if no permits */}
        {Object.keys(groupedPermits).length === 0 && (
          <Card className="text-center py-8">
            <CardContent>
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No School Permits</h3>
              <p className="text-muted-foreground mb-4">
                Add your first permit range to get started managing attestation numbers.
              </p>
              <Button onClick={handleOpenDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Permit Range
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingPermit ? "Edit Permit Range" : "Add New Permit Range"}
            </DialogTitle>
            <DialogDescription>
              {editingPermit 
                ? "Add new attestation numbers to this permit range" 
                : "Enter the government permit number range details"
              }
            </DialogDescription>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="permitCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Permit Code</FormLabel>
                    <FormControl>
                      <Input placeholder="L-020" {...field} />
                    </FormControl>
                    <FormDescription>
                      Government-assigned permit identifier
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} value={field.value} data-testid="select-location">
                        <SelectTrigger>
                          <SelectValue placeholder="Select a location" />
                        </SelectTrigger>
                        <SelectContent>
                          {locations.map((location) => (
                            <SelectItem key={location.id} value={location.name}>
                              {location.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      Select the city location for this permit range
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="courseTypes"
                render={() => (
                  <FormItem>
                    <FormLabel>Course Types</FormLabel>
                    <div className="space-y-2">
                      {courseTypeOptions.map((option) => (
                        <FormField
                          key={option.value}
                          control={form.control}
                          name="courseTypes"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(option.value)}
                                  onCheckedChange={(checked) => {
                                    const currentValues = field.value || [];
                                    if (checked) {
                                      field.onChange([...currentValues, option.value]);
                                    } else {
                                      field.onChange(currentValues.filter((value) => value !== option.value));
                                    }
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal">
                                {option.label}
                              </FormLabel>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="startNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Number</FormLabel>
                      <FormControl>
                        <div className="flex gap-2">
                          <Input 
                            type="number" 
                            {...field} 
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                            disabled={!editingStartNumber}
                            className={!editingStartNumber ? "bg-gray-50 text-gray-600" : ""}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingStartNumber(!editingStartNumber)}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                        </div>
                      </FormControl>
                      <FormDescription>
                        First attestation number in the range
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity to Add</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="200"
                          {...field} 
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormDescription>
                        Number of attestation numbers to add (e.g., 50, 100, 200)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Calculated End Number Display */}
                {form.watch("startNumber") > 0 && form.watch("quantity") > 0 && (
                  <div className="p-3 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-lg border-2 border-amber-200 shadow-md">
                    <div className="text-sm font-bold text-amber-900">Calculated Range</div>
                    <div className="text-lg font-mono font-bold bg-gradient-to-r from-[#ECC462] to-amber-600 bg-clip-text text-transparent">
                      {form.watch("startNumber").toLocaleString()} - {(form.watch("startNumber") + form.watch("quantity") - 1).toLocaleString()}
                    </div>
                    <div className="text-xs font-medium text-amber-700">
                      Total: {form.watch("quantity").toLocaleString()} numbers
                    </div>
                  </div>
                )}
              </div>

              {/* Expiry Tracking Section */}
              <div className="border-t pt-4 mt-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Expiry Tracking
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="issueDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Issue Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="expiryDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Expiry Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Notes Section */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Any additional notes about this permit..."
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createPermitMutation.isPending || updatePermitMutation.isPending}
                  className="bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg hover:shadow-xl transition-all duration-200"
                >
                  {editingPermit ? "Update" : "Create"} Permit
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
        </div>
      </div>
    </div>
  );
}