import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapPin, Building, Clock, Plus, X } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertLocationSchema, type Location, type InsertLocation } from "@shared/schema";
import { z } from "zod";

// Enhanced validation schema with proper address validation rules
const formSchema = insertLocationSchema.extend({
  name: z.string().min(2, "Location name must be at least 2 characters").max(100, "Location name too long"),
  address: z.string().min(5, "Address must be at least 5 characters").max(200, "Address too long"),
  city: z.string().min(2, "City name must be at least 2 characters").max(50, "City name too long"),
  province: z.string().min(2, "Province must be at least 2 characters").max(50, "Province name too long"),
  postalCode: z.string()
    .min(6, "Postal code is required")
    .max(7, "Invalid postal code format")
    .refine(
      (val) => /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(val),
      "Invalid Canadian postal code format (e.g., T2P 1J9)"
    ),
  phone: z.string()
    .optional()
    .refine(
      (val) => !val || /^[\d\s\-\(\)\+\.]{10,20}$/.test(val),
      "Invalid phone number format"
    ),
  email: z.string()
    .optional()
    .refine(
      (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      "Invalid email format"
    ),
  locationCode: z.string()
    .optional()
    .refine(
      (val) => !val || /^[A-Za-z]{2,4}$/.test(val),
      "Location code must be 2-4 letters (e.g., DT, NW)"
    ),
});

type FormData = z.infer<typeof formSchema>;

interface LocationFormProps {
  location?: Location | null;
  onSuccess: () => void;
}



const daysOfWeek = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
];

export default function LocationForm({ location, onSuccess }: LocationFormProps) {
  const isEditing = !!location;
  const { toast } = useToast();

  const [operatingHours, setOperatingHours] = useState<Record<string, { open: string; close: string; closed: boolean }>>(
    location?.operatingHours ? 
      (typeof location.operatingHours === 'object' ? location.operatingHours as Record<string, any> : JSON.parse(location.operatingHours as string)) : 
      {}
  );


  const { register, handleSubmit, formState: { errors }, reset, setValue, control } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: location?.name || "",
      address: location?.address || "",
      city: location?.city || "",
      postalCode: location?.postalCode || "",
      province: location?.province || "",
      country: location?.country || "Canada",
      phone: location?.phone || "",
      email: location?.email || "",
      isActive: location?.isActive ?? true,
      isPrimary: location?.isPrimary ?? false,
      locationCode: location?.locationCode || "",

      notes: location?.notes || "",
    },
  });

  const locationMutation = useMutation({
    mutationFn: async (data: InsertLocation) => {
      return isEditing 
        ? apiRequest('PUT', `/api/locations/${location!.id}`, data)
        : apiRequest('POST', '/api/locations', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({
        title: "Success",
        description: `Location ${isEditing ? 'updated' : 'created'} successfully`,
      });
      reset();
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: `Failed to ${isEditing ? 'update' : 'create'} location: ${error?.message || 'Unknown error'}`,
        variant: "destructive",
      });
    },
  });



  const updateOperatingHours = (day: string, field: string, value: string | boolean) => {
    setOperatingHours(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value
      }
    }));
  };

  const onSubmit = (data: FormData) => {
    const finalData: InsertLocation = {
      ...data,
      operatingHours: JSON.stringify(operatingHours),
    };
    
    locationMutation.mutate(finalData);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="hours">Operating Hours</TabsTrigger>
        </TabsList>

        {/* Basic Information Tab */}
        <TabsContent value="basic" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                Location Details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Location Name *</Label>
                <Input 
                  id="name"
                  {...register("name")} 
                  placeholder="e.g., Downtown Branch"
                />
                {errors.name && <p className="text-red-500 text-sm">{errors.name.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="locationCode">Location Code</Label>
                <Input 
                  id="locationCode"
                  {...register("locationCode")} 
                  placeholder="e.g., DT, NW, SE"
                  maxLength={4}
                />
                {errors.locationCode && <p className="text-red-500 text-sm">{errors.locationCode.message}</p>}
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="address">Address *</Label>
                <Input 
                  id="address"
                  {...register("address")} 
                  placeholder="123 Main Street"
                />
                {errors.address && <p className="text-red-500 text-sm">{errors.address.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="city">City *</Label>
                <Input 
                  id="city"
                  {...register("city")} 
                  placeholder="Calgary"
                />
                {errors.city && <p className="text-red-500 text-sm">{errors.city.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="province">Province *</Label>
                <Input 
                  id="province"
                  {...register("province")} 
                  placeholder="Alberta"
                />
                {errors.province && <p className="text-red-500 text-sm">{errors.province.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="postalCode">Postal Code *</Label>
                <Input 
                  id="postalCode"
                  {...register("postalCode")} 
                  placeholder="T2P 1J9"
                />
                {errors.postalCode && <p className="text-red-500 text-sm">{errors.postalCode.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input 
                  id="country"
                  {...register("country")} 
                  placeholder="Canada"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input 
                  id="phone"
                  {...register("phone")} 
                  placeholder="(403) 123-4567"
                />
                {errors.phone && <p className="text-red-500 text-sm">{errors.phone.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input 
                  id="email"
                  type="email"
                  {...register("email")} 
                  placeholder="location@mortys.com"
                />
                {errors.email && <p className="text-red-500 text-sm">{errors.email.message}</p>}
              </div>



              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Controller
                    name="isActive"
                    control={control}
                    render={({ field }) => (
                      <Checkbox 
                        id="isActive"
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(!!checked)}
                        data-testid="checkbox-isActive"
                      />
                    )}
                  />
                  <Label htmlFor="isActive">Active Location</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Controller
                    name="isPrimary"
                    control={control}
                    render={({ field }) => (
                      <Checkbox 
                        id="isPrimary"
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(!!checked)}
                        data-testid="checkbox-isPrimary"
                      />
                    )}
                  />
                  <Label htmlFor="isPrimary">Primary Location</Label>
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea 
                  id="notes"
                  {...register("notes")} 
                  placeholder="Additional information about this location..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>



        {/* Operating Hours Tab */}
        <TabsContent value="hours" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Operating Hours
              </CardTitle>
              <CardDescription>
                Set the operating hours for each day of the week
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {daysOfWeek.map((day) => (
                  <div key={day} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                    <div className="font-medium">{day}</div>
                    
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        checked={operatingHours[day]?.closed || false}
                        onCheckedChange={(checked) => updateOperatingHours(day, 'closed', checked)}
                      />
                      <Label>Closed</Label>
                    </div>

                    {!operatingHours[day]?.closed && (
                      <>
                        <div className="space-y-1">
                          <Label>Open Time</Label>
                          <Input
                            type="time"
                            value={operatingHours[day]?.open || "09:00"}
                            onChange={(e) => updateOperatingHours(day, 'open', e.target.value)}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label>Close Time</Label>
                          <Input
                            type="time"
                            value={operatingHours[day]?.close || "17:00"}
                            onChange={(e) => updateOperatingHours(day, 'close', e.target.value)}
                          />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Form Actions */}
      <div className="flex justify-end space-x-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onSuccess}>
          Cancel
        </Button>
        <Button type="submit" disabled={locationMutation.isPending}>
          {locationMutation.isPending && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
          )}
          {isEditing ? 'Update Location' : 'Create Location'}
        </Button>
      </div>
    </form>
  );
}