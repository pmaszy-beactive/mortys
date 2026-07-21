import { useState } from "react";
import { Bug, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function BugReportButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("technical_support");
  const [description, setDescription] = useState("");
  const { toast } = useToast();

  const submitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/bug-reports", {
        category,
        description: description.trim(),
        pageUrl: window.location.pathname,
      });
    },
    onSuccess: () => {
      setOpen(false);
      setDescription("");
      setCategory("technical_support");
      toast({
        title: "Report submitted",
        description: "Thanks! Our support team has been notified.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not submit report",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!description.trim()) {
      toast({
        title: "Description required",
        description: "Please describe the issue before submitting.",
        variant: "destructive",
      });
      return;
    }
    submitMutation.mutate();
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className={`p-2 text-gray-500 hover:text-[#111111] ${className}`}
        title="Report a problem"
        data-testid="button-bug-report"
      >
        <Bug className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bug className="h-5 w-5 text-[#ECC462]" />
              Report a Problem
            </DialogTitle>
            <DialogDescription>
              Tell us what went wrong and our support team will look into it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="bug-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="bug-category" data-testid="select-bug-category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="technical_support" data-testid="option-technical-support">
                    Technical Support
                  </SelectItem>
                  <SelectItem value="billing" data-testid="option-billing">
                    Billing
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bug-description">
                Description <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="bug-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the problem you ran into..."
                rows={5}
                maxLength={5000}
                data-testid="input-bug-description"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitMutation.isPending}
              data-testid="button-cancel-bug-report"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitMutation.isPending || !description.trim()}
              className="bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90"
              data-testid="button-submit-bug-report"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Report"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
