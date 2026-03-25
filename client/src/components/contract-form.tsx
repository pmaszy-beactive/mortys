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
import { insertContractSchema, type Contract, type Student } from "@shared/schema";
import { getCoursePrice } from "@/lib/utils";
import { z } from "zod";

const contractFormSchema = insertContractSchema.extend({
  contractDate: z.string().min(1, "Contract date is required"),
});

type ContractFormData = z.infer<typeof contractFormSchema>;

interface ContractFormProps {
  contract?: Partial<Contract>;
  onSuccess: () => void;
}

export default function ContractForm({ contract, onSuccess }: ContractFormProps) {
  const { toast } = useToast();
  const isEditing = !!contract;

  const { data: studentsData } = useQuery<{ students: Student[] }>({
    queryKey: ["/api/students"],
  });
  
  const students = studentsData?.students || [];

  const form = useForm<ContractFormData>({
    resolver: zodResolver(contractFormSchema),
    defaultValues: {
      studentId: contract?.studentId || null,
      courseType: contract?.courseType || "auto",
      contractDate: contract?.contractDate || new Date().toISOString().split('T')[0],
      amount: contract?.amount || "1200.00",
      paymentMethod: contract?.paymentMethod || "full",
      status: contract?.status || "pending",
      specialNotes: contract?.specialNotes || "",
      attestationGenerated: contract?.attestationGenerated || false,
    },
  });

  const watchedCourseType = form.watch("courseType");

  const createMutation = useMutation({
    mutationFn: (data: ContractFormData) => apiRequest("POST", "/api/contracts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Contract created successfully",
      });
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create contract",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: ContractFormData) => apiRequest("PUT", `/api/contracts/${contract!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Contract updated successfully",
      });
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update contract",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ContractFormData) => {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  // Update amount when course type changes
  const handleCourseTypeChange = (courseType: string) => {
    form.setValue("courseType", courseType);
    form.setValue("amount", getCoursePrice(courseType).toString() + ".00");
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="studentId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Student</FormLabel>
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
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="courseType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Course Type</FormLabel>
                <Select onValueChange={handleCourseTypeChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select course..." />
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

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="contractDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contract Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount</FormLabel>
                <FormControl>
                  <Input type="number" min="0" step="0.01" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="paymentMethod"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Payment Method</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select payment..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="full">Full Payment</SelectItem>
                    <SelectItem value="installment">Installment Plan</SelectItem>
                    <SelectItem value="transfer">Course Transfer</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select status..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="specialNotes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Special Notes</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Any special terms or conditions..." 
                  rows={3}
                  {...field} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-4 pt-4">
          <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
            {createMutation.isPending || updateMutation.isPending ? "Saving..." : isEditing ? "Update Contract" : "Create Contract"}
          </Button>
          <Button type="button" variant="outline" onClick={onSuccess}>
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}
