import { useEffect } from "react";
import { useLocation } from "wouter";

export default function StudentSignup() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/student/register");
  }, [setLocation]);
  return null;
}
