import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Calendar, Clock } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Class } from "@shared/schema";

interface RequestChangeModalProps {
  classData: Class;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RequestChangeModal({ classData, open, onOpenChange }: RequestChangeModalProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [suggestedDate, setSuggestedDate] = useState("");
  const [suggestedTime, setSuggestedTime] = useState("");

  const requestChangeMutation = useMutation({
    mutationFn: async () => {
      const suggestedDateTime = suggestedDate && suggestedTime 
        ? `${suggestedDate} at ${suggestedTime}` 
        : undefined;
      
      return await apiRequest("POST", `/api/instructor/classes/${classData.id}/request-change`, {
        reason: reason.trim(),
        suggestedTime: suggestedDateTime,
      });
    },
    onSuccess: () => {
      toast({
        title: "Change Request Submitted",
        description: "Your change request has been sent to the admin for review.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/classes"] });
      
      // Reset form and close modal
      setReason("");
      setSuggestedDate("");
      setSuggestedTime("");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit change request",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!reason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for the change request",
        variant: "destructive",
      });
      return;
    }
    requestChangeMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#111111]">Request Schedule Change</DialogTitle>
          <DialogDescription>
            Request a change for {classData.courseType.toUpperCase()} Class {classData.classNumber} on {classData.date}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason" className="text-sm font-semibold text-[#111111]">
              Reason for Change Request <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Personal emergency, conflicting appointment, illness..."
              className="min-h-[100px] border-gray-300 focus:border-[#ECC462] focus:ring-[#ECC462]"
              data-testid="input-change-reason"
            />
          </div>

          {/* Optional Suggested Date */}
          <div className="space-y-2">
            <Label htmlFor="suggested-date" className="text-sm font-semibold text-[#111111] flex items-center">
              <Calendar className="mr-1 h-4 w-4 text-[#ECC462]" />
              Suggested New Date (Optional)
            </Label>
            <Input
              id="suggested-date"
              type="date"
              value={suggestedDate}
              onChange={(e) => setSuggestedDate(e.target.value)}
              className="border-gray-300 focus:border-[#ECC462] focus:ring-[#ECC462]"
              data-testid="input-suggested-date"
            />
          </div>

          {/* Optional Suggested Time */}
          <div className="space-y-2">
            <Label htmlFor="suggested-time" className="text-sm font-semibold text-[#111111] flex items-center">
              <Clock className="mr-1 h-4 w-4 text-[#ECC462]" />
              Suggested New Time (Optional)
            </Label>
            <Input
              id="suggested-time"
              type="time"
              value={suggestedTime}
              onChange={(e) => setSuggestedTime(e.target.value)}
              className="border-gray-300 focus:border-[#ECC462] focus:ring-[#ECC462]"
              data-testid="input-suggested-time"
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={requestChangeMutation.isPending}
            className="w-full sm:w-auto border-gray-300"
            data-testid="button-cancel-change"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={requestChangeMutation.isPending}
            className="w-full sm:w-auto bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90 hover:text-[#111111] font-semibold shadow-md"
            data-testid="button-submit-change"
          >
            {requestChangeMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Request"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
