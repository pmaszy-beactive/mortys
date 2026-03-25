import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Calendar, Clock, Plus, Edit, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertInstructorAvailabilitySchema, type Instructor, type InstructorAvailability } from "@shared/schema";
import { z } from "zod";

const availabilityFormSchema = insertInstructorAvailabilitySchema.extend({
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format"),
});

type AvailabilityFormData = z.infer<typeof availabilityFormSchema>;

interface InstructorAvailabilityProps {
  instructor: Instructor;
}

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export default function InstructorAvailability({ instructor }: InstructorAvailabilityProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAvailability, setEditingAvailability] = useState<InstructorAvailability | null>(null);
  const { toast } = useToast();

  const { data: availability = [], isLoading, refetch } = useQuery<InstructorAvailability[]>({
    queryKey: [`/api/instructors/${instructor.id}/availability`],
    staleTime: 0, // Always refetch
    cacheTime: 0, // Don't cache
  });

  const form = useForm<AvailabilityFormData>({
    resolver: zodResolver(availabilityFormSchema),
    defaultValues: {
      instructorId: instructor.id,
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "17:00",
      isAvailable: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: AvailabilityFormData) => 
      apiRequest("POST", `/api/instructors/${instructor.id}/availability`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/instructors/${instructor.id}/availability`] });
      toast({
        title: "Success",
        description: "Availability added successfully",
      });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add availability",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; updateData: Partial<AvailabilityFormData> }) => 
      apiRequest("PUT", `/api/instructors/availability/${data.id}`, data.updateData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/instructors/${instructor.id}/availability`] });
      toast({
        title: "Success",
        description: "Availability updated successfully",
      });
      setIsDialogOpen(false);
      setEditingAvailability(null);
      form.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update availability",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => 
      apiRequest("DELETE", `/api/instructors/availability/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/instructors/${instructor.id}/availability`] });
      toast({
        title: "Success",
        description: "Availability deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete availability",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: AvailabilityFormData) => {
    if (editingAvailability) {
      updateMutation.mutate({
        id: editingAvailability.id,
        updateData: data,
      });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (availabilityItem: InstructorAvailability) => {
    setEditingAvailability(availabilityItem);
    form.reset({
      instructorId: availabilityItem.instructorId,
      dayOfWeek: availabilityItem.dayOfWeek,
      startTime: availabilityItem.startTime,
      endTime: availabilityItem.endTime,
      isAvailable: availabilityItem.isAvailable,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this availability slot?")) {
      deleteMutation.mutate(id);
    }
  };

  const sortedAvailability = availability.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startTime.localeCompare(b.startTime);
  });

  return (
    <Card className="mobile-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center">
            <Calendar className="mr-2 h-5 w-5" />
            Availability Schedule
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="touch-target">
                <Plus className="h-4 w-4 mr-2" />
                Add Slot
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingAvailability ? "Edit Availability" : "Add Availability Slot"}
                </DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="dayOfWeek"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Day of Week</FormLabel>
                        <Select onValueChange={(value) => field.onChange(parseInt(value))} value={field.value?.toString()}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select day" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {DAYS_OF_WEEK.map((day) => (
                              <SelectItem key={day.value} value={day.value.toString()}>
                                {day.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="startTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Start Time</FormLabel>
                          <FormControl>
                            <Input type="time" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="endTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>End Time</FormLabel>
                          <FormControl>
                            <Input type="time" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="isAvailable"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel>Available for scheduling</FormLabel>
                          <div className="text-sm text-gray-500">
                            Enable this slot for automatic scheduling
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <div className="flex flex-col sm:flex-row gap-2 pt-4">
                    <Button 
                      type="submit" 
                      disabled={createMutation.isPending || updateMutation.isPending}
                      className="w-full sm:w-auto touch-target"
                    >
                      {createMutation.isPending || updateMutation.isPending 
                        ? "Saving..." 
                        : editingAvailability ? "Update Slot" : "Add Slot"}
                    </Button>
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => {
                        setIsDialogOpen(false);
                        setEditingAvailability(null);
                        form.reset();
                      }}
                      className="w-full sm:w-auto touch-target"
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sortedAvailability.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No availability slots configured</p>
            <p className="text-sm">Add time slots to enable scheduling</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedAvailability.map((slot) => (
              <div key={slot.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center space-x-3">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="font-medium">
                      {DAYS_OF_WEEK.find(d => d.value === slot.dayOfWeek)?.label}
                    </p>
                    <p className="text-sm text-gray-600">
                      {slot.startTime} - {slot.endTime}
                    </p>
                  </div>
                  <Badge variant={slot.isAvailable ? "default" : "secondary"}>
                    {slot.isAvailable ? "Available" : "Blocked"}
                  </Badge>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleEdit(slot)}
                    className="touch-target"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(slot.id)}
                    className="touch-target text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}