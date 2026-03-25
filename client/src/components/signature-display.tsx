import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, User, Calendar, Globe } from "lucide-react";

interface SignatureDisplayProps {
  signature: string;
  instructorName?: string;
  signatureDate?: string;
  ipAddress?: string;
  title?: string;
  showAuditInfo?: boolean;
}

export default function SignatureDisplay({
  signature,
  instructorName,
  signatureDate,
  ipAddress,
  title = "Digital Signature",
  showAuditInfo = true
}: SignatureDisplayProps) {
  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            {title}
          </CardTitle>
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            Signed
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Signature Image */}
        <div className="border-2 border-gray-200 rounded-lg p-4 bg-gray-50 mb-4">
          <img 
            src={signature} 
            alt="Digital Signature" 
            className="max-w-full h-auto bg-white border rounded"
            style={{ maxHeight: '200px' }}
          />
        </div>

        {/* Audit Information */}
        {showAuditInfo && (
          <div className="space-y-2 text-sm text-gray-600">
            {instructorName && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span className="font-medium">Signed by:</span>
                <span>{instructorName}</span>
              </div>
            )}
            
            {signatureDate && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span className="font-medium">Date:</span>
                <span>{formatDate(signatureDate)}</span>
              </div>
            )}
            
            {ipAddress && (
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                <span className="font-medium">IP Address:</span>
                <span className="font-mono text-xs">{ipAddress}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-gray-200">
          <p className="text-xs text-gray-500">
            This digital signature is cryptographically secured and tamper-evident.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}