import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Download, 
  Upload, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Users, 
  Database,
  PlayCircle,
  StopCircle,
  TestTube
} from "lucide-react";

interface MigrationProgress {
  inProgress: boolean;
  totalStudents: number;
  processedStudents: number;
  currentLetter: string;
  errors: string[];
  estimatedTimeRemaining: string | null;
}

interface MigrationStats {
  totalMigratedStudents: number;
  migrationDate: string | null;
  errors: string[];
  duration: string | null;
}

export default function DataMigration() {
  const [credentials, setCredentials] = useState({ username: "", password: "" });
  const [showCredentials, setShowCredentials] = useState(false);
  const { toast } = useToast();

  // Get migration progress
  const { data: progress, refetch: refetchProgress } = useQuery<MigrationProgress>({
    queryKey: ["/api/migration/progress"],
    refetchInterval: 5000,
  });

  // Get migration statistics
  const { data: stats } = useQuery<MigrationStats>({
    queryKey: ["/api/migration/stats"],
  });

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async (creds: { username: string; password: string }) => {
      const response = await apiRequest("POST", "/api/migration/test-connection", creds);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: "Connection Successful",
          description: data.message,
        });
      } else {
        toast({
          title: "Connection Failed",
          description: data.message,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Connection Error",
        description: `Failed to test connection: ${error}`,
        variant: "destructive",
      });
    },
  });

  // Start migration mutation
  const startMigrationMutation = useMutation({
    mutationFn: async (creds: { username: string; password: string }) => {
      const response = await apiRequest("POST", "/api/migration/start", creds);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Migration Started",
        description: data.message,
      });
      refetchProgress();
      queryClient.invalidateQueries({ queryKey: ["/api/migration/stats"] });
    },
    onError: (error) => {
      toast({
        title: "Migration Failed",
        description: `Failed to start migration: ${error}`,
        variant: "destructive",
      });
    },
  });

  // Stop migration mutation
  const stopMigrationMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/migration/stop");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Migration Stopped",
        description: data.message,
      });
      refetchProgress();
    },
    onError: (error) => {
      toast({
        title: "Stop Failed",
        description: `Failed to stop migration: ${error}`,
        variant: "destructive",
      });
    },
  });

  const handleTestConnection = () => {
    if (!credentials.username || !credentials.password) {
      toast({
        title: "Missing Credentials",
        description: "Please enter both username and password",
        variant: "destructive",
      });
      return;
    }
    testConnectionMutation.mutate(credentials);
  };

  const handleStartMigration = () => {
    if (!credentials.username || !credentials.password) {
      toast({
        title: "Missing Credentials",
        description: "Please enter both username and password",
        variant: "destructive",
      });
      return;
    }
    startMigrationMutation.mutate(credentials);
  };

  const handleStopMigration = () => {
    stopMigrationMutation.mutate();
  };

  const getProgressPercentage = () => {
    if (!progress || progress.totalStudents === 0) return 0;
    return Math.round((progress.processedStudents / progress.totalStudents) * 100);
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">Data Migration</h1>
          <p className="text-muted-foreground">
            Import student data from the legacy DriveTraqr system
          </p>
        </div>
        <Badge className={progress?.inProgress ? "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] shadow-md" : "bg-gray-100 text-gray-800"}>
          {progress?.inProgress ? "In Progress" : "Ready"}
        </Badge>
      </div>

      {/* Migration Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Students</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalMigratedStudents || 0}</div>
            <p className="text-xs text-muted-foreground">
              Students in database
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Migration Progress</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {progress?.processedStudents || 0}
              {progress?.totalStudents ? ` / ${progress.totalStudents}` : ''}
            </div>
            <p className="text-xs text-muted-foreground">
              {progress?.inProgress ? `Processing letter: ${progress.currentLetter}` : 'Not running'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Time Remaining</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {progress?.estimatedTimeRemaining || "Unknown"}
            </div>
            <p className="text-xs text-muted-foreground">
              Estimated completion
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Progress Bar */}
      {progress?.inProgress && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5" />
              Migration in Progress
            </CardTitle>
            <CardDescription>
              Currently processing students from the legacy system
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{getProgressPercentage()}%</span>
              </div>
              <Progress value={getProgressPercentage()} className="w-full" />
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <strong>Current Letter:</strong> {progress.currentLetter}
              </div>
              <div>
                <strong>Students Processed:</strong> {progress.processedStudents}
              </div>
            </div>

            <Button 
              onClick={handleStopMigration}
              variant="destructive"
              disabled={stopMigrationMutation.isPending}
              className="w-full"
            >
              <StopCircle className="mr-2 h-4 w-4" />
              Stop Migration
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connection Setup */}
      {!progress?.inProgress && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Legacy System Connection
            </CardTitle>
            <CardDescription>
              Enter your DriveTraqr admin credentials to begin the migration process
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter admin username"
                  value={credentials.username}
                  onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type={showCredentials ? "text" : "password"}
                  placeholder="Enter admin password"
                  value={credentials.password}
                  onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="showPassword"
                checked={showCredentials}
                onChange={(e) => setShowCredentials(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="showPassword" className="text-sm">
                Show credentials
              </Label>
            </div>

            <Separator />

            <div className="flex gap-2">
              <Button
                onClick={handleTestConnection}
                variant="outline"
                disabled={testConnectionMutation.isPending}
                className="flex-1"
              >
                <TestTube className="mr-2 h-4 w-4" />
                Test Connection
              </Button>
              
              <Button
                onClick={handleStartMigration}
                disabled={startMigrationMutation.isPending}
                className="flex-1 bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg hover:shadow-xl transition-all duration-200"
              >
                <Upload className="mr-2 h-4 w-4" />
                Start Migration
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Migration Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Migration Process</CardTitle>
          <CardDescription>
            How the data migration works
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#ECC462] to-amber-500 flex items-center justify-center text-sm font-medium text-[#111111] shadow-md">
                1
              </div>
              <div>
                <strong>Authentication:</strong> Connect to mortys.drivetraqr.ca using admin credentials
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#ECC462] to-amber-500 flex items-center justify-center text-sm font-medium text-[#111111] shadow-md">
                2
              </div>
              <div>
                <strong>Student Discovery:</strong> Search through alphabetical student listings (A-Z)
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#ECC462] to-amber-500 flex items-center justify-center text-sm font-medium text-[#111111] shadow-md">
                3
              </div>
              <div>
                <strong>Data Extraction:</strong> Scrape profiles, test results, payment history, and documents
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#ECC462] to-amber-500 flex items-center justify-center text-sm font-medium text-[#111111] shadow-md">
                4
              </div>
              <div>
                <strong>Data Import:</strong> Create student records, contracts, evaluations, and notes
              </div>
            </div>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              The migration process may take several hours to complete 100,000+ student records. 
              You can safely close this page - the process will continue running in the background.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Error Log */}
      {progress?.errors && progress.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Migration Errors ({progress.errors.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {progress.errors.map((error, index) => (
                <div key={index} className="text-sm p-2 bg-destructive/10 rounded">
                  {error}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}