import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Car, Users, Calendar, FileText, BarChart3, LogIn, UserCheck, Award, Shield, Clock, CheckCircle2, Star, MapPin, Phone, Mail, ArrowRight, BookOpen, Target, Trophy, User, Bike, Truck, Facebook, Twitter, Instagram, Youtube } from "lucide-react";
import mortysLogo from '@/assets/mortys-logo.png';

export default function Landing() {

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50 backdrop-blur-sm bg-white/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <img src={mortysLogo} alt="Morty's Driving School" className="h-12 w-auto" data-testid="img-mortys-logo" />
            <div>
              <h1 className="text-2xl font-bold text-secondary">Morty's Driving School</h1>
              <p className="text-xs text-gray-600 hidden sm:block">Learn to Drive with Confidence</p>
            </div>
          </div>
          <div className="flex space-x-2">
            <Button 
              variant="outline"
              className="flex items-center space-x-2 border-gray-300 text-secondary hover:bg-gray-50"
              onClick={() => window.location.href = '/instructor'}
              data-testid="button-instructor-portal"
            >
              <UserCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Instructor Portal</span>
            </Button>
            <Button 
              className="flex items-center space-x-2 bg-primary hover:bg-primary/90 text-secondary font-semibold shadow-lg hover:shadow-primary/50 transition-all hover:scale-105"
              onClick={() => window.location.href = '/student/login'}
              data-testid="button-student-portal"
            >
              <GraduationCap className="h-4 w-4" />
              <span className="hidden sm:inline">Student Portal</span>
            </Button>
            <Button 
              className="flex items-center space-x-2 bg-secondary hover:bg-secondary/90 text-white"
              onClick={() => window.location.href = '/admin/login'}
              data-testid="button-admin-login"
            >
              <LogIn className="h-4 w-4" />
              <span>Admin Login</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-secondary via-gray-900 to-secondary text-white overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5"></div>
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDEzNEg2djZoMzB2LTZ6TTYgMTQ2aDMwdjZINnYtNnoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-10"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32 relative z-10">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="text-left">
              <Badge className="gold-badge mb-6 px-4 py-1 text-base" data-testid="badge-trusted">
                Trusted by 10,000+ Students
              </Badge>
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight mb-6">
                Learn to Drive with
                <span className="block text-primary mt-2">Confidence</span>
              </h2>
              <p className="text-xl text-gray-300 mb-8 leading-relaxed max-w-lg">
                Montreal's premier driving school offering expert instruction, flexible scheduling, and a proven track record of success.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  size="lg" 
                  className="btn-primary text-lg px-8 py-7 shadow-2xl hover:shadow-primary/30"
                  data-testid="button-start-learning"
                >
                  <Calendar className="h-5 w-5 mr-2" />
                  Start Learning Today
                </Button>
                <Button 
                  size="lg" 
                  variant="outline"
                  className="text-lg px-8 py-7 bg-white/10 border-white/30 hover:bg-white/20 text-white backdrop-blur-sm"
                  onClick={() => document.getElementById('instructors')?.scrollIntoView({ behavior: 'smooth' })}
                  data-testid="button-meet-instructors"
                >
                  <Users className="h-5 w-5 mr-2" />
                  Meet Our Instructors
                </Button>
              </div>
              
              {/* Trust Indicators */}
              <div className="mt-12 grid grid-cols-3 gap-6">
                <div className="text-center" data-testid="stat-pass-rate">
                  <div className="text-3xl font-bold text-primary">98%</div>
                  <div className="text-sm text-gray-400 mt-1">Pass Rate</div>
                </div>
                <div className="text-center" data-testid="stat-instructors">
                  <div className="text-3xl font-bold text-primary">15+</div>
                  <div className="text-sm text-gray-400 mt-1">Expert Instructors</div>
                </div>
                <div className="text-center" data-testid="stat-experience">
                  <div className="text-3xl font-bold text-primary">25</div>
                  <div className="text-sm text-gray-400 mt-1">Years Experience</div>
                </div>
              </div>
            </div>
            
            <div className="hidden md:flex items-center justify-center">
              <div className="relative">
                <div className="absolute -inset-4 bg-gradient-to-r from-primary to-primary/50 rounded-3xl blur-2xl opacity-20 animate-pulse"></div>
                <div className="relative">
                  <img src={mortysLogo} alt="Morty's Driving School" className="w-96 h-auto drop-shadow-2xl" data-testid="img-hero-logo" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Portal Access Section */}
      <section className="py-16 bg-gradient-to-br from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h3 className="text-3xl font-bold text-secondary mb-3">Access Your Portal</h3>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Quick access to your personalized dashboard and resources
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {/* Student Portal Card */}
            <Card 
              className="premium-card border-2 border-primary bg-gradient-to-br from-primary/5 to-white hover:shadow-2xl hover:shadow-primary/20 hover:scale-105 transition-all duration-300 cursor-pointer group"
              onClick={() => window.location.href = '/student/login'}
              data-testid="card-student-portal"
            >
              <CardHeader className="text-center pb-4">
                <div className="w-20 h-20 bg-gradient-to-br from-primary to-primary/80 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg group-hover:scale-110 transition-transform">
                  <GraduationCap className="h-10 w-10 text-secondary" />
                </div>
                <CardTitle className="text-secondary text-xl">Student Portal</CardTitle>
                <CardDescription className="text-gray-600">
                  Access your classes, progress, and evaluations
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <Button 
                  className="w-full bg-primary hover:bg-primary/90 text-secondary font-semibold shadow-md"
                  data-testid="button-access-student-portal"
                >
                  Access Portal
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            {/* Instructor Portal Card */}
            <Card 
              className="premium-card hover:shadow-xl hover:scale-105 transition-all duration-300 cursor-pointer group"
              onClick={() => window.location.href = '/instructor'}
              data-testid="card-instructor-portal"
            >
              <CardHeader className="text-center pb-4">
                <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-50 border-2 border-gray-200 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:border-primary group-hover:scale-110 transition-all">
                  <UserCheck className="h-10 w-10 text-secondary" />
                </div>
                <CardTitle className="text-secondary text-xl">Instructor Portal</CardTitle>
                <CardDescription className="text-gray-600">
                  Manage your schedule and student progress
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <Button 
                  variant="outline"
                  className="w-full border-gray-300 text-secondary hover:bg-gray-50"
                  data-testid="button-access-instructor-portal"
                >
                  Access Portal
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            {/* Admin Portal Card */}
            <Card 
              className="premium-card hover:shadow-xl hover:scale-105 transition-all duration-300 cursor-pointer group"
              onClick={() => window.location.href = '/admin/login'}
              data-testid="card-admin-portal"
            >
              <CardHeader className="text-center pb-4">
                <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-50 border-2 border-gray-200 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:border-secondary group-hover:scale-110 transition-all">
                  <Shield className="h-10 w-10 text-secondary" />
                </div>
                <CardTitle className="text-secondary text-xl">Admin Portal</CardTitle>
                <CardDescription className="text-gray-600">
                  Complete school management system
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <Button 
                  variant="outline"
                  className="w-full border-gray-300 text-secondary hover:bg-gray-50"
                  data-testid="button-access-admin-portal"
                >
                  Access Portal
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h3 className="text-3xl sm:text-4xl font-bold text-secondary mb-4">Our Services</h3>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Comprehensive training programs designed to help you succeed at every stage of your driving journey.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="premium-card hover:shadow-lg hover:scale-105" data-testid="card-service-auto">
              <CardHeader className="text-center pb-4">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Car className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-secondary">Auto Lessons</CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-gray-600">
                  Complete car driving course with theory and driving sessions. Learn to drive safely and confidently on Montreal roads.
                </p>
              </CardContent>
            </Card>

            <Card className="premium-card hover:shadow-lg hover:scale-105" data-testid="card-service-moto">
              <CardHeader className="text-center pb-4">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Bike className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-secondary">Motorcycle Training</CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-gray-600">
                  Professional motorcycle instruction for all skill levels. Master two-wheel riding with safety and confidence.
                </p>
              </CardContent>
            </Card>

            <Card className="premium-card hover:shadow-lg hover:scale-105" data-testid="card-service-scooter">
              <CardHeader className="text-center pb-4">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Truck className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-secondary">Scooter Classes</CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-gray-600">
                  Learn to operate scooters safely with our specialized training program. Perfect for urban commuting.
                </p>
              </CardContent>
            </Card>

            <Card className="premium-card hover:shadow-lg hover:scale-105" data-testid="card-service-theory">
              <CardHeader className="text-center pb-4">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <BookOpen className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-secondary">Theory Classes</CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-gray-600">
                  12 comprehensive theory classes covering road rules, signs, and safety regulations required for licensing.
                </p>
              </CardContent>
            </Card>

            <Card className="premium-card hover:shadow-lg hover:scale-105" data-testid="card-service-road-test">
              <CardHeader className="text-center pb-4">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Target className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-secondary">Road Test Prep</CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-gray-600">
                  Specialized preparation for your road test. Practice exam routes and gain confidence for test day success.
                </p>
              </CardContent>
            </Card>

            <Card className="premium-card hover:shadow-lg hover:scale-105" data-testid="card-service-advanced">
              <CardHeader className="text-center pb-4">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Award className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-secondary">Advanced Training</CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-gray-600">
                  Enhance your skills with defensive driving, highway training, and weather condition handling techniques.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>


      {/* Featured Instructors Section */}
      <section id="instructors" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h3 className="text-3xl sm:text-4xl font-bold text-secondary mb-4">Meet Our Expert Instructors</h3>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Our certified instructors bring years of experience and a passion for teaching safe driving.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <Card className="premium-card hover:shadow-xl group" data-testid="card-instructor-jean-marc">
              <div className="relative h-48 bg-gradient-to-br from-secondary to-gray-800 flex items-center justify-center mb-4 -m-6 mb-6 rounded-t-2xl">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE0SDZ2Nmgz MHYtNnpNNiAxNGgzMHY2SDZ2LTZ6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-10 rounded-t-2xl"></div>
                <div className="relative w-28 h-28 bg-white rounded-full flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                  <User className="h-14 w-14 text-primary" />
                </div>
              </div>
              <CardHeader className="pt-0">
                <CardTitle className="text-xl text-secondary">Jean-Marc Tremblay</CardTitle>
                <CardDescription className="text-base">Senior Driving Instructor</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  <Badge className="gold-badge">Auto</Badge>
                  <Badge className="gold-badge">Theory</Badge>
                  <Badge className="gold-badge">15+ Years</Badge>
                </div>
                <p className="text-gray-600 text-sm mb-4">
                  Specializes in beginner training and defensive driving techniques. Fluent in French and English.
                </p>
                <div className="flex items-center text-primary">
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <span className="ml-2 text-sm text-gray-600">5.0 (248 reviews)</span>
                </div>
              </CardContent>
            </Card>

            <Card className="premium-card hover:shadow-xl group" data-testid="card-instructor-sarah">
              <div className="relative h-48 bg-gradient-to-br from-primary to-yellow-600 flex items-center justify-center mb-4 -m-6 mb-6 rounded-t-2xl">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE0SDZ2Nmgz MHYtNnpNNiAxNGgzMHY2SDZ2LTZ6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-10 rounded-t-2xl"></div>
                <div className="relative w-28 h-28 bg-white rounded-full flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                  <User className="h-14 w-14 text-secondary" />
                </div>
              </div>
              <CardHeader className="pt-0">
                <CardTitle className="text-xl text-secondary">Sarah Williams</CardTitle>
                <CardDescription className="text-base">Motorcycle Specialist</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  <Badge className="gold-badge">Motorcycle</Badge>
                  <Badge className="gold-badge">Safety Expert</Badge>
                  <Badge className="gold-badge">12+ Years</Badge>
                </div>
                <p className="text-gray-600 text-sm mb-4">
                  Expert in safety techniques and confident riding. Passionate about two-wheel education.
                </p>
                <div className="flex items-center text-primary">
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <span className="ml-2 text-sm text-gray-600">5.0 (182 reviews)</span>
                </div>
              </CardContent>
            </Card>

            <Card className="premium-card hover:shadow-xl group" data-testid="card-instructor-michael">
              <div className="relative h-48 bg-gradient-to-br from-secondary to-gray-800 flex items-center justify-center mb-4 -m-6 mb-6 rounded-t-2xl">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE0SDZ2Nmgz MHYtNnpNNiAxNGgzMHY2SDZ2LTZ6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-10 rounded-t-2xl"></div>
                <div className="relative w-28 h-28 bg-white rounded-full flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                  <User className="h-14 w-14 text-primary" />
                </div>
              </div>
              <CardHeader className="pt-0">
                <CardTitle className="text-xl text-secondary">Michael Chen</CardTitle>
                <CardDescription className="text-base">Advanced Driving Coach</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  <Badge className="gold-badge">Test Prep</Badge>
                  <Badge className="gold-badge">Highway Expert</Badge>
                  <Badge className="gold-badge">10+ Years</Badge>
                </div>
                <p className="text-gray-600 text-sm mb-4">
                  Known for patience and helping nervous students build confidence for their road tests.
                </p>
                <div className="flex items-center text-primary">
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <Star className="h-4 w-4 fill-current" />
                  <span className="ml-2 text-sm text-gray-600">5.0 (195 reviews)</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h3 className="text-3xl sm:text-4xl font-bold text-secondary mb-4">What Our Students Say</h3>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Don't just take our word for it — hear from students who've succeeded with us.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <Card className="premium-card hover:shadow-xl" data-testid="card-testimonial-emma">
              <CardContent className="pt-6">
                <div className="flex items-center text-primary mb-4" data-testid="rating-stars-emma">
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                </div>
                <p className="text-gray-700 mb-6 italic leading-relaxed">
                  "Best driving school in Montreal! Jean-Marc was incredibly patient and helped me pass my test on the first try. Highly recommend!"
                </p>
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-gradient-to-br from-primary to-yellow-600 rounded-full flex items-center justify-center mr-3 shadow-md">
                    <span className="text-white font-bold">EC</span>
                  </div>
                  <div>
                    <div className="font-semibold text-secondary">Emma Chen</div>
                    <div className="text-sm text-gray-500">Graduated July 2024</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="premium-card hover:shadow-xl" data-testid="card-testimonial-alex">
              <CardContent className="pt-6">
                <div className="flex items-center text-primary mb-4" data-testid="rating-stars-alex">
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                </div>
                <p className="text-gray-700 mb-6 italic leading-relaxed">
                  "Sarah made learning to ride a motorcycle so much fun and safe. Her teaching style is clear and she really cares about her students."
                </p>
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-gradient-to-br from-secondary to-gray-700 rounded-full flex items-center justify-center mr-3 shadow-md">
                    <span className="text-primary font-bold">AL</span>
                  </div>
                  <div>
                    <div className="font-semibold text-secondary">Alex Lavoie</div>
                    <div className="text-sm text-gray-500">Graduated June 2024</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="premium-card hover:shadow-xl" data-testid="card-testimonial-sophie">
              <CardContent className="pt-6">
                <div className="flex items-center text-primary mb-4" data-testid="rating-stars-sophie">
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                  <Star className="h-5 w-5 fill-current" />
                </div>
                <p className="text-gray-700 mb-6 italic leading-relaxed">
                  "I was really nervous about driving but Michael was so supportive. The flexible schedule made it easy to fit lessons into my life."
                </p>
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-gradient-to-br from-primary to-yellow-600 rounded-full flex items-center justify-center mr-3 shadow-md">
                    <span className="text-white font-bold">SP</span>
                  </div>
                  <div>
                    <div className="font-semibold text-secondary">Sophie Patel</div>
                    <div className="text-sm text-gray-500">Graduated August 2024</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Enrollment CTA Section */}
      <section className="py-20 bg-gradient-to-br from-secondary via-gray-900 to-secondary text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h3 className="text-3xl sm:text-4xl font-bold mb-4">Ready to Start Your Journey?</h3>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto mb-8">
              Join thousands of successful students and start your driving education with Montreal's most trusted driving school.
            </p>
            <Button 
              size="lg" 
              className="btn-primary text-xl px-12 py-8 shadow-2xl hover:shadow-primary/40"
              data-testid="button-enroll-now"
            >
              <Calendar className="mr-2 h-6 w-6" />
              Enroll Now
            </Button>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 mt-16 pt-12 border-t border-gray-800">
            <div className="text-center" data-testid="contact-location">
              <div className="w-14 h-14 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
                <MapPin className="h-7 w-7 text-secondary" />
              </div>
              <h4 className="font-semibold text-lg mb-2">Main Location</h4>
              <p className="text-gray-400">123 Rue Saint-Laurent</p>
              <p className="text-gray-400">Montreal, QC H2X 2T3</p>
              <p className="text-sm text-gray-500 mt-2">Also serving Laval & DDO</p>
            </div>

            <div className="text-center" data-testid="contact-phone">
              <div className="w-14 h-14 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
                <Phone className="h-7 w-7 text-secondary" />
              </div>
              <h4 className="font-semibold text-lg mb-2">Phone</h4>
              <p className="text-gray-400 text-lg">(514) 555-DRIVE</p>
              <p className="text-sm text-gray-500 mt-2">Mon-Sat: 8am - 8pm</p>
            </div>

            <div className="text-center" data-testid="contact-email">
              <div className="w-14 h-14 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
                <Mail className="h-7 w-7 text-secondary" />
              </div>
              <h4 className="font-semibold text-lg mb-2">Email</h4>
              <p className="text-gray-400">info@mortysdriving.com</p>
              <p className="text-sm text-gray-500 mt-2">24-hour response time</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-secondary text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div className="md:col-span-1">
              <div className="flex items-center space-x-3 mb-4">
                <img src={mortysLogo} alt="Morty's" className="h-10 w-auto" data-testid="img-footer-logo" />
              </div>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                Montreal's trusted driving school since 2000. Building confident, safe drivers for over two decades.
              </p>
              <div className="flex space-x-4">
                <a href="#" className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center hover:bg-yellow-500 transition-colors" aria-label="Facebook" data-testid="link-social-facebook">
                  <Facebook className="h-5 w-5 text-secondary" />
                </a>
                <a href="#" className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center hover:bg-yellow-500 transition-colors" aria-label="Instagram" data-testid="link-social-instagram">
                  <Instagram className="h-5 w-5 text-secondary" />
                </a>
                <a href="#" className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center hover:bg-yellow-500 transition-colors" aria-label="Youtube" data-testid="link-social-youtube">
                  <Youtube className="h-5 w-5 text-secondary" />
                </a>
              </div>
            </div>
            
            <div>
              <h4 className="font-semibold text-white mb-4 text-lg">Programs</h4>
              <ul className="space-y-3 text-gray-400">
                <li><a href="#" className="hover:text-primary transition-colors" data-testid="link-program-auto">Auto Lessons</a></li>
                <li><a href="#" className="hover:text-primary transition-colors" data-testid="link-program-moto">Motorcycle Training</a></li>
                <li><a href="#" className="hover:text-primary transition-colors" data-testid="link-program-theory">Theory Classes</a></li>
                <li><a href="#" className="hover:text-primary transition-colors" data-testid="link-program-test">Road Test Prep</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold text-white mb-4 text-lg">Company</h4>
              <ul className="space-y-3 text-gray-400">
                <li><a href="#" className="hover:text-primary transition-colors" data-testid="link-about">About Us</a></li>
                <li><a href="#instructors" className="hover:text-primary transition-colors" data-testid="link-instructors">Our Instructors</a></li>
                <li><a href="#" className="hover:text-primary transition-colors" data-testid="link-locations">Locations</a></li>
                <li><a href="#" className="hover:text-primary transition-colors" data-testid="link-careers">Careers</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold text-white mb-4 text-lg">Contact</h4>
              <ul className="space-y-3 text-gray-400">
                <li className="flex items-center space-x-2">
                  <Phone className="h-4 w-4 text-primary" />
                  <span>(514) 555-DRIVE</span>
                </li>
                <li className="flex items-center space-x-2">
                  <Mail className="h-4 w-4 text-primary" />
                  <span>info@mortysdriving.com</span>
                </li>
                <li className="flex items-start space-x-2">
                  <MapPin className="h-4 w-4 text-primary mt-1" />
                  <span>123 Rue Saint-Laurent<br />Montreal, QC H2X 2T3</span>
                </li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center text-sm text-gray-400">
            <p>© 2025 Morty's Driving School. All rights reserved.</p>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <a href="#" className="hover:text-primary transition-colors" data-testid="link-privacy">Privacy Policy</a>
              <a href="#" className="hover:text-primary transition-colors" data-testid="link-terms">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
