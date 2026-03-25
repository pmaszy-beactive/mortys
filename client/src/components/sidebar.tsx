import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Car, Users, Presentation, Calendar, ClipboardCheck, Mail, BarChart3, Menu, X, Video, FileText, CreditCard, MapPin, TrendingUp, Settings, LogOut, Shield, FileCheck, Receipt, DollarSign, ChevronDown, ChevronRight, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { NotificationCenter } from "@/components/notification-center";
import { GlobalSearchBar } from "@/components/global-search-bar";
import versionData from "../../../version.json";

const version: string = versionData.version;

type NavItem = {
  name: string;
  href?: string;
  icon: any;
  children?: { name: string; href: string; icon: any }[];
};

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/", icon: BarChart3 },
  { name: "Students", href: "/students", icon: Users },
  { name: "Instructors", href: "/instructors", icon: Presentation },
  { name: "Scheduling", href: "/scheduling", icon: Calendar },
  { 
    name: "Finance", 
    icon: Wallet,
    children: [
      { name: "Payment Reconciliation", href: "/payment-reconciliation", icon: Receipt },
      { name: "Transaction Audit", href: "/transaction-audit", icon: DollarSign },
      { name: "Course Transfer", href: "/transfer-credits", icon: CreditCard },
    ]
  },
  { 
    name: "Settings", 
    icon: Settings,
    children: [
      { name: "Locations", href: "/locations", icon: MapPin },
      { name: "Vehicles", href: "/vehicles", icon: Car },
      { name: "School Permits", href: "/school-permits", icon: FileText },
      { name: "Communications", href: "/communications", icon: Mail },
      { name: "Reports", href: "/reports", icon: BarChart3 },
      { name: "Registration Reports", href: "/registration-reports", icon: FileText },
      { name: "Analytics", href: "/analytics", icon: TrendingUp },
      { name: "Zoom Integration", href: "/zoom", icon: Video },
      { name: "Booking Policies", href: "/booking-policies", icon: Shield },
      { name: "Override Audit Logs", href: "/override-audit-logs", icon: Shield },
      { name: "Document Verification", href: "/document-verification", icon: FileCheck },
      { name: "System Settings", href: "/settings", icon: Settings },
    ]
  },
];

export default function Sidebar() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<string[]>([]);
  const { toast } = useToast();

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const toggleSubmenu = (name: string) => {
    setExpandedMenus(prev => 
      prev.includes(name) 
        ? prev.filter(n => n !== name)
        : [...prev, name]
    );
  };

  const isChildActive = (children?: { href: string }[]) => {
    if (!children) return false;
    return children.some(child => location === child.href);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      toast({
        title: "Logged out successfully",
        description: "You have been logged out of your account.",
      });
      window.location.href = '/admin-login';
    } catch (error) {
      console.error('Logout error:', error);
      window.location.href = '/admin-login';
    }
  };

  return (
    <>
      {/* Mobile menu button */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-[#ECC462] rounded-md flex items-center justify-center mr-2">
              <Car className="text-[#111111] h-5 w-5" />
            </div>
            <h1 className="text-lg font-bold text-gray-900">Morty's</h1>
          </div>
          <div className="flex items-center gap-1">
            <NotificationCenter userType="admin" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 touch-target"
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </Button>
          </div>
        </div>
        <GlobalSearchBar userType="admin" />
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div 
          className="md:hidden fixed inset-0 z-40 bg-black bg-opacity-50"
          onClick={closeMobileMenu}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out
        md:translate-x-0 md:static md:inset-0
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex flex-col h-full">
          {/* Logo and Brand - Desktop */}
          <div className="hidden md:flex flex-col flex-shrink-0 px-4 py-5 mb-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-10 h-10 bg-[#ECC462] rounded-md flex items-center justify-center">
                  <Car className="text-[#111111] h-6 w-6" />
                </div>
                <div className="ml-3">
                  <h1 className="text-xl font-bold text-gray-900">Morty's</h1>
                  <p className="text-sm text-gray-500">Driving School</p>
                </div>
              </div>
              <NotificationCenter userType="admin" />
            </div>
            <GlobalSearchBar userType="admin" />
          </div>

          {/* Mobile top spacing - increased for search bar */}
          <div className="md:hidden h-24"></div>

          {/* Navigation Menu */}
          <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
            {navigation.map((item) => {
              const Icon = item.icon;
              
              if (item.children) {
                const isExpanded = expandedMenus.includes(item.name) || isChildActive(item.children);
                const hasActiveChild = isChildActive(item.children);
                
                return (
                  <div key={item.name}>
                    <button
                      onClick={() => toggleSubmenu(item.name)}
                      className={`sidebar-link touch-target w-full justify-between ${hasActiveChild ? 'text-primary font-medium' : ''}`}
                    >
                      <span className="flex items-center">
                        <Icon className="mr-3 flex-shrink-0 h-4 w-4" />
                        {item.name}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="ml-4 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                        {item.children.map((child) => {
                          const isChildItemActive = location === child.href;
                          const ChildIcon = child.icon;
                          return (
                            <Link
                              key={child.name}
                              href={child.href}
                              onClick={closeMobileMenu}
                              className={`sidebar-link touch-target text-sm ${isChildItemActive ? 'active' : ''}`}
                            >
                              <ChildIcon className="mr-3 flex-shrink-0 h-3.5 w-3.5" />
                              {child.name}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
              
              const isActive = location === item.href;
              return (
                <Link 
                  key={item.name} 
                  href={item.href!} 
                  onClick={closeMobileMenu}
                  className={`sidebar-link touch-target ${isActive ? 'active' : ''}`}
                >
                  <Icon className="mr-3 flex-shrink-0 h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Version */}
          <div className="px-4 py-1 text-center">
            <span className="text-[10px] text-gray-400 font-mono tracking-wide" data-testid="text-version-admin">v{version}</span>
          </div>

          {/* User Profile & Logout */}
          <div className="flex-shrink-0 border-t border-gray-200">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center min-w-0">
                <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
                  <Users className="text-gray-600 h-4 w-4" />
                </div>
                <div className="ml-3 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">Admin User</p>
                  <p className="text-xs text-gray-500 truncate">Office Manager</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="ml-2 flex-shrink-0 text-[#111111] hover:text-[#ECC462] transition-colors p-2"
                data-testid="button-logout"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
