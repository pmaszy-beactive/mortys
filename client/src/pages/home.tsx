import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogOut, Users, GraduationCap, Calendar, Award, MapPin } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Sidebar from "@/components/sidebar";

interface DashboardStatsData {
  activeStudents: number;
  totalStudents: number;
  activeInstructors: number;
  classesThisWeek: number;
  pendingContracts: number;
  totalContracts: number;
}

function DashboardStats() {
  const { data: stats, isLoading } = useQuery<DashboardStatsData>({
    queryKey: ["/api/dashboard/stats"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 bg-gray-200 rounded w-20"></div>
              <div className="h-4 w-4 bg-gray-200 rounded"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-gray-200 rounded w-16 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-24"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Students</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats?.activeStudents || 0}</div>
          <p className="text-xs text-muted-foreground">
            {stats?.totalStudents ? `${stats.totalStudents} total` : 'Loading...'}
          </p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Classes This Week</CardTitle>
          <Calendar className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats?.classesThisWeek || 0}</div>
          <p className="text-xs text-muted-foreground">Scheduled sessions</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Instructors</CardTitle>
          <GraduationCap className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats?.activeInstructors || 0}</div>
          <p className="text-xs text-muted-foreground">Available today</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      window.location.reload();
    } catch (error) {
      console.error('Logout error:', error);
      window.location.reload();
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col md:ml-0 pt-16 md:pt-0">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-6">
              <div className="flex items-center">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
                  <p className="mt-1 text-sm text-gray-600">
                    Welcome back! Here's what's happening at Morty's Driving School today.
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                {user && (
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                      <span className="text-white text-sm font-medium">
                        {user.firstName?.[0] || user.username[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="text-sm">
                      <p className="font-medium text-gray-900">
                        {user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username}
                      </p>
                      <p className="text-gray-600">{user.email || user.role}</p>
                    </div>
                  </div>
                )}
                <Button onClick={handleLogout} variant="outline" size="sm">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="mb-8">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Welcome back{user?.firstName ? `, ${user.firstName}` : ''}!
            </h3>
            <p className="text-gray-600 dark:text-gray-300">
              Access your complete driving school management system
            </p>
            </div>

            {/* Quick Access Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => window.location.href = '/students'}>
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Students</CardTitle>
                    <CardDescription>Manage enrollment</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>

            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => window.location.href = '/instructors'}>
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                    <GraduationCap className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Instructors</CardTitle>
                    <CardDescription>Team management</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>

            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => window.location.href = '/classes'}>
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center">
                    <Calendar className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Classes</CardTitle>
                    <CardDescription>Schedule & booking</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>

            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => window.location.href = '/locations'}>
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900 rounded-lg flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Locations</CardTitle>
                    <CardDescription>Multi-branch mgmt</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
            </div>

            {/* Stats Section */}
            <DashboardStats />
          </div>
        </main>
      </div>
    </div>
  );
}