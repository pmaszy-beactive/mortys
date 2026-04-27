import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Card, CardContent, CardDescription, CardHeader, CardTitle 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { 
  Plus, Search, Edit, Trash2, Car, AlertTriangle, CheckCircle, Wrench, Loader2, Bike
} from "lucide-react";

// Vehicle type
interface Vehicle {
  id: number;
  licensePlate: string;
  make: string;
  model: string;
  year: number;
  vehicleType: string;
  color?: string;
  vin?: string;
  status: string;
  registrationExpiry?: string;
  insuranceExpiry?: string;
  lastMaintenanceDate?: string;
  maintenanceNotes?: string;
  fuelType?: string;
  transmission?: string;
  notes?: string;
}

// Form schema
const vehicleFormSchema = z.object({
  licensePlate: z.string().min(1, "License plate is required"),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.number({ invalid_type_error: "Year must be a number" })
    .min(1900, "Year must be 1900 or later")
    .max(new Date().getFullYear() + 1, "Year cannot be in the future"),
  vehicleType: z.string().min(1, "Vehicle type is required"),
  color: z.string().optional(),
  vin: z.string().optional().refine((val) => {
    if (!val || val.length === 0) return true;
    return val.length === 17;
  }, "VIN must be exactly 17 characters if provided"),
  status: z.string().min(1, "Status is required"),
  registrationExpiry: z.string().optional(),
  insuranceExpiry: z.string().optional(),
  lastMaintenanceDate: z.string().optional(),
  maintenanceNotes: z.string().optional(),
  fuelType: z.string().optional(),
  transmission: z.string().optional(),
  notes: z.string().optional(),
});

type VehicleFormData = z.infer<typeof vehicleFormSchema>;

// Vehicle form component
function VehicleForm({ 
  vehicle, 
  onSuccess 
}: { 
  vehicle?: Vehicle; 
  onSuccess: () => void; 
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<VehicleFormData>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: {
      licensePlate: vehicle?.licensePlate || "",
      make: vehicle?.make || "",
      model: vehicle?.model || "",
      year: vehicle?.year || new Date().getFullYear(),
      vehicleType: vehicle?.vehicleType || "auto",
      color: vehicle?.color || "",
      vin: vehicle?.vin || "",
      status: vehicle?.status || "active",
      registrationExpiry: vehicle?.registrationExpiry || "",
      insuranceExpiry: vehicle?.insuranceExpiry || "",
      lastMaintenanceDate: vehicle?.lastMaintenanceDate || "",
      maintenanceNotes: vehicle?.maintenanceNotes || "",
      fuelType: vehicle?.fuelType || "",
      transmission: vehicle?.transmission || "",
      notes: vehicle?.notes || "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: VehicleFormData) => {
      return apiRequest("POST", "/api/vehicles", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      toast({ 
        title: "✓ Success", 
        description: "Vehicle created successfully",
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0"
      });
      form.reset();
      onSuccess();
    },
    onError: (error: any) => {
      console.error('Vehicle creation error:', error);
      
      let errorTitle = "Error";
      let errorMessage = "Failed to create vehicle";
      
      if (error?.data?.message) {
        const message = error.data.message.toLowerCase();
        
        if (message.includes("duplicate") || message.includes("already exists") || message.includes("unique")) {
          errorTitle = "Duplicate Vehicle";
          if (message.includes("license plate") || message.includes("licenseplate")) {
            errorMessage = "A vehicle with this license plate already exists. Please use a different license plate.";
          } else if (message.includes("vin")) {
            errorMessage = "A vehicle with this VIN already exists. Please check the VIN number.";
          } else {
            errorMessage = "This vehicle already exists in the system. Please check the license plate or VIN.";
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
    mutationFn: async (data: VehicleFormData) => {
      return apiRequest("PUT", `/api/vehicles/${vehicle!.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      toast({ 
        title: "✓ Success", 
        description: "Vehicle updated successfully",
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0"
      });
      onSuccess();
    },
    onError: (error: any) => {
      console.error('Vehicle update error:', error);
      
      let errorTitle = "Error";
      let errorMessage = "Failed to update vehicle";
      
      if (error?.data?.message) {
        const message = error.data.message.toLowerCase();
        
        if (message.includes("duplicate") || message.includes("already exists") || message.includes("unique")) {
          errorTitle = "Duplicate Vehicle";
          if (message.includes("license plate") || message.includes("licenseplate")) {
            errorMessage = "A vehicle with this license plate already exists. Please use a different license plate.";
          } else if (message.includes("vin")) {
            errorMessage = "A vehicle with this VIN already exists. Please check the VIN number.";
          } else {
            errorMessage = "This vehicle already exists in the system. Please check the license plate or VIN.";
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

  const onSubmit = (data: VehicleFormData) => {
    if (vehicle) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="licensePlate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>License Plate *</FormLabel>
                <FormControl>
                  <Input placeholder="ABC-1234" {...field} data-testid="input-license-plate" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="vehicleType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vehicle Type *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-vehicle-type">
                      <SelectValue placeholder="Select vehicle type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="motorcycle">Motorcycle</SelectItem>
                    <SelectItem value="scooter">Scooter</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="make"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Make *</FormLabel>
                <FormControl>
                  <Input placeholder="Toyota" {...field} data-testid="input-make" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="model"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Model *</FormLabel>
                <FormControl>
                  <Input placeholder="Corolla" {...field} data-testid="input-model" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="year"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Year *</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    placeholder="2020" 
                    {...field}
                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                    data-testid="input-year"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Color</FormLabel>
                <FormControl>
                  <Input placeholder="White" {...field} data-testid="input-color" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="vin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>VIN (Optional)</FormLabel>
                <FormControl>
                  <Input placeholder="1HGBH41JXMN109186" {...field} data-testid="input-vin" />
                </FormControl>
                <FormDescription className="text-xs text-gray-500">
                  17-character Vehicle Identification Number (optional)
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="out_of_service">Out of Service</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="transmission"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Transmission</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-transmission">
                      <SelectValue placeholder="Select transmission" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="automatic">Automatic</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="fuelType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fuel Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-fuel-type">
                      <SelectValue placeholder="Select fuel type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="gasoline">Gasoline</SelectItem>
                    <SelectItem value="electric">Electric</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="registrationExpiry"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Registration Expiry</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-registration-expiry" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="insuranceExpiry"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Insurance Expiry</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-insurance-expiry" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lastMaintenanceDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last Maintenance Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-last-maintenance-date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="maintenanceNotes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Maintenance Notes</FormLabel>
              <FormControl>
                <Textarea placeholder="Recent maintenance history..." {...field} data-testid="textarea-maintenance-notes" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea placeholder="Additional notes about this vehicle..." {...field} data-testid="textarea-notes" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end space-x-2">
          <Button 
            type="submit" 
            disabled={isLoading}
            data-testid="button-submit-vehicle"
            className="bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111]"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#111111]" />}
            {isLoading ? "Saving..." : vehicle ? "Update Vehicle" : "Create Vehicle"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// Main vehicles page
export default function VehiclesPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"all" | "auto" | "moto">("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: vehicles = [], isLoading } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
    staleTime: 0,
    gcTime: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/vehicles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      toast({ 
        title: "✓ Success", 
        description: "Vehicle deleted successfully",
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0"
      });
    },
    onError: (error: any) => {
      console.error('Vehicle deletion error:', error);
      
      let errorMessage = "Failed to delete vehicle";
      if (error?.data?.message) {
        errorMessage = error.data.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      toast({ 
        title: "Error", 
        description: errorMessage,
        variant: "destructive" 
      });
    },
  });

  // Split vehicles by tab
  const autoVehicles = vehicles.filter(v => v.vehicleType === "auto");
  const motoVehicles = vehicles.filter(v => v.vehicleType === "motorcycle" || v.vehicleType === "scooter");

  const filterVehicles = (list: Vehicle[]) =>
    list.filter(vehicle => {
      const matchesSearch =
        vehicle.licensePlate.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vehicle.make.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vehicle.model.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === "all" || vehicle.status === statusFilter;
      return matchesSearch && matchesStatus;
    });

  const filteredVehicles = filterVehicles(vehicles);
  const filteredAuto = filterVehicles(autoVehicles);
  const filteredMoto = filterVehicles(motoVehicles);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>;
      case "maintenance":
        return <Badge className="bg-yellow-100 text-yellow-800"><Wrench className="w-3 h-3 mr-1" />Maintenance</Badge>;
      case "out_of_service":
        return <Badge className="bg-red-100 text-red-800"><AlertTriangle className="w-3 h-3 mr-1" />Out of Service</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-amber-50 to-yellow-50">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="animate-pulse space-y-8">
            <div className="h-12 bg-gradient-to-r from-gray-200 to-gray-300 rounded-xl w-1/3"></div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-40 bg-gradient-to-br from-gray-200 to-gray-300 rounded-2xl"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-amber-50 to-yellow-50">
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="mb-10">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">
                  Vehicles
                </h1>
                <Car className="h-8 w-8 text-[#ECC462]" />
              </div>
              <p className="text-lg text-gray-600 font-medium">
                Manage vehicle fleet with license plates and assignments.
              </p>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  className="bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg hover:shadow-xl transition-all duration-200"
                  data-testid="button-add-vehicle"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Vehicle
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Vehicle</DialogTitle>
                <DialogDescription>
                  Add a new vehicle to the fleet with license plate and details.
                </DialogDescription>
              </DialogHeader>
              <VehicleForm onSuccess={() => setIsCreateDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
          <Card className="border-0 shadow-xl bg-gradient-to-br from-amber-500 to-yellow-500 hover:shadow-2xl transition-all duration-300 hover:scale-105">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-3 shadow-lg">
                  <Car className="h-7 w-7 text-white" />
                </div>
                <Badge className="bg-white/30 text-white border-0 shadow-md hover:bg-white/40">
                  Total
                </Badge>
              </div>
              <div>
                <p className="text-amber-100 text-sm font-semibold uppercase tracking-wide mb-1">Total Vehicles</p>
                <p className="text-5xl font-bold text-white mb-1">{vehicles.length}</p>
                <p className="text-amber-100 text-xs">in the fleet</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-xl bg-gradient-to-br from-green-500 to-emerald-600 hover:shadow-2xl transition-all duration-300 hover:scale-105">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-3 shadow-lg">
                  <CheckCircle className="h-7 w-7 text-white" />
                </div>
                <Badge className="bg-white/30 text-white border-0 shadow-md hover:bg-white/40">
                  Active
                </Badge>
              </div>
              <div>
                <p className="text-green-100 text-sm font-semibold uppercase tracking-wide mb-1">Active</p>
                <p className="text-5xl font-bold text-white mb-1">
                  {vehicles.filter(v => v.status === 'active').length}
                </p>
                <p className="text-green-100 text-xs">ready to drive</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-xl bg-gradient-to-br from-blue-500 to-blue-600 hover:shadow-2xl transition-all duration-300 hover:scale-105">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-3 shadow-lg">
                  <Car className="h-7 w-7 text-white" />
                </div>
                <Badge className="bg-white/30 text-white border-0 shadow-md hover:bg-white/40">
                  Auto
                </Badge>
              </div>
              <div>
                <p className="text-blue-100 text-sm font-semibold uppercase tracking-wide mb-1">Auto</p>
                <p className="text-5xl font-bold text-white mb-1">{autoVehicles.length}</p>
                <p className="text-blue-100 text-xs">automobiles</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-xl bg-gradient-to-br from-purple-500 to-purple-600 hover:shadow-2xl transition-all duration-300 hover:scale-105">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-3 shadow-lg">
                  <Bike className="h-7 w-7 text-white" />
                </div>
                <Badge className="bg-white/30 text-white border-0 shadow-md hover:bg-white/40">
                  Moto
                </Badge>
              </div>
              <div>
                <p className="text-purple-100 text-sm font-semibold uppercase tracking-wide mb-1">Moto</p>
                <p className="text-5xl font-bold text-white mb-1">{motoVehicles.length}</p>
                <p className="text-purple-100 text-xs">motorcycles &amp; scooters</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs + Search/Filter + Table */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "all" | "auto" | "moto")}>
          {/* Tab bar + filters row */}
          <Card className="mb-6 border-0 shadow-xl bg-white/80 backdrop-blur-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <TabsList className="bg-gray-100 p-1 rounded-xl h-auto self-start">
                  <TabsTrigger
                    value="all"
                    className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold data-[state=active]:bg-[#ECC462] data-[state=active]:text-[#111111] data-[state=active]:shadow-md"
                  >
                    <Car className="h-4 w-4" />
                    All
                    <Badge className="ml-1 bg-white/60 text-gray-700 border-0 text-xs px-1.5">{vehicles.length}</Badge>
                  </TabsTrigger>
                  <TabsTrigger
                    value="auto"
                    className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold data-[state=active]:bg-[#ECC462] data-[state=active]:text-[#111111] data-[state=active]:shadow-md"
                  >
                    <Car className="h-4 w-4" />
                    Auto
                    <Badge className="ml-1 bg-white/60 text-gray-700 border-0 text-xs px-1.5">{autoVehicles.length}</Badge>
                  </TabsTrigger>
                  <TabsTrigger
                    value="moto"
                    className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold data-[state=active]:bg-[#ECC462] data-[state=active]:text-[#111111] data-[state=active]:shadow-md"
                  >
                    <Bike className="h-4 w-4" />
                    Moto
                    <Badge className="ml-1 bg-white/60 text-gray-700 border-0 text-xs px-1.5">{motoVehicles.length}</Badge>
                  </TabsTrigger>
                </TabsList>

                <div className="flex flex-1 gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-amber-600 h-4 w-4" />
                    <Input
                      placeholder="Search by license plate, make, or model..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 transition-all duration-200 focus:ring-2 focus:ring-amber-500"
                      data-testid="input-search-vehicles"
                    />
                  </div>

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-44 transition-all duration-200 focus:ring-2 focus:ring-amber-500" data-testid="select-filter-status">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="out_of_service">Out of Service</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    onClick={() => { setSearchTerm(""); setStatusFilter("all"); }}
                    className="hover:bg-amber-50 hover:border-amber-300 transition-all duration-200"
                    data-testid="button-clear-filters"
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Reusable vehicle table */}
          {(["all", "auto", "moto"] as const).map((tab) => {
            const list = tab === "all" ? filteredVehicles : tab === "auto" ? filteredAuto : filteredMoto;
            const emptyAll = tab === "all" ? vehicles.length === 0 : tab === "auto" ? autoVehicles.length === 0 : motoVehicles.length === 0;
            const tabLabel = tab === "all" ? "Vehicle Fleet" : tab === "auto" ? "Auto Fleet" : "Moto Fleet";
            return (
              <TabsContent key={tab} value={tab}>
                <Card className="mb-8 border-0 shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-shadow duration-300">
                  <CardHeader className="border-b bg-gradient-to-r from-amber-50 to-yellow-50 pb-4">
                    <CardTitle className="text-2xl font-bold bg-gradient-to-r from-[#ECC462] to-amber-600 bg-clip-text text-transparent">
                      {tabLabel} ({list.length})
                    </CardTitle>
                    <CardDescription className="mt-1 text-gray-600">
                      Manage your driving school vehicle fleet and assignments.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    {list.length === 0 ? (
                      <div className="text-center py-8">
                        {tab === "moto" ? <Bike className="mx-auto h-12 w-12 text-gray-400 mb-4" /> : <Car className="mx-auto h-12 w-12 text-gray-400 mb-4" />}
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No vehicles found</h3>
                        <p className="text-gray-500">
                          {emptyAll
                            ? "Get started by adding your first vehicle to the fleet."
                            : "Try adjusting your search or filter criteria."}
                        </p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-gradient-to-r from-amber-50 to-yellow-50">
                              <TableHead className="font-bold text-gray-700">License Plate</TableHead>
                              <TableHead className="font-bold text-gray-700">Vehicle</TableHead>
                              {tab === "all" && <TableHead className="font-bold text-gray-700">Type</TableHead>}
                              <TableHead className="font-bold text-gray-700">Year</TableHead>
                              <TableHead className="font-bold text-gray-700">Status</TableHead>
                              <TableHead className="font-bold text-gray-700">Transmission</TableHead>
                              <TableHead className="font-bold text-gray-700 text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {list.map((vehicle) => (
                              <TableRow
                                key={vehicle.id}
                                className="hover:bg-gradient-to-r hover:from-amber-50 hover:to-yellow-50 transition-colors duration-200"
                              >
                                <TableCell className="font-bold text-gray-900">{vehicle.licensePlate}</TableCell>
                                <TableCell>
                                  <div>
                                    <div className="font-bold text-gray-900">{vehicle.make} {vehicle.model}</div>
                                    {vehicle.color && <div className="text-sm text-gray-500">{vehicle.color}</div>}
                                  </div>
                                </TableCell>
                                {tab === "all" && (
                                  <TableCell>
                                    <Badge className="bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] shadow-md capitalize">
                                      {vehicle.vehicleType}
                                    </Badge>
                                  </TableCell>
                                )}
                                <TableCell className="font-medium text-gray-900">{vehicle.year}</TableCell>
                                <TableCell>{getStatusBadge(vehicle.status)}</TableCell>
                                <TableCell>
                                  {vehicle.transmission && (
                                    <Badge className="bg-gray-100 text-gray-800 capitalize">{vehicle.transmission}</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end space-x-2">
                                    <Dialog>
                                      <DialogTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => setEditingVehicle(vehicle)}
                                          className="hover:bg-amber-50 hover:border-amber-300 transition-all duration-200 shadow-sm hover:shadow-md"
                                          data-testid={`button-edit-vehicle-${vehicle.id}`}
                                        >
                                          <Edit className="h-4 w-4" />
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                                        <DialogHeader>
                                          <DialogTitle>Edit Vehicle</DialogTitle>
                                          <DialogDescription>Update vehicle information and details.</DialogDescription>
                                        </DialogHeader>
                                        <VehicleForm vehicle={editingVehicle!} onSuccess={() => setEditingVehicle(null)} />
                                      </DialogContent>
                                    </Dialog>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        if (window.confirm("Are you sure you want to delete this vehicle?")) {
                                          deleteMutation.mutate(vehicle.id);
                                        }
                                      }}
                                      className="text-red-600 hover:text-red-900 hover:bg-red-50 transition-all duration-200 shadow-sm hover:shadow-md"
                                      data-testid={`button-delete-vehicle-${vehicle.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </div>
  );
}