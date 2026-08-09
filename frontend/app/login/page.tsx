"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { Hotel, Lock, Mail, ArrowRight } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormValues) => {
    // In a real app, we'd call the API Gateway here.
    // We mock the successful login and redirect to overview.
    console.log("Login credentials:", data);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    router.push("/analytics");
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-white p-4">
      <div className="w-full max-w-sm border border-gray-200 rounded-lg p-8">
        {/* Header */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mb-3">
            <Hotel className="w-5 h-5 text-black" />
          </div>
          <h1 className="font-medium text-[15px] text-black">
            Manager Dashboard
          </h1>
          <p className="font-normal text-[10.5px] text-black/60 mt-1">
            Sign in to access your administrative workspace.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div>
            <label
              className="font-normal text-[10px] text-black/60 block mb-1"
              htmlFor="email"
            >
              Email address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="h-4 w-4 text-black/40" />
              </div>
              <input
                id="email"
                type="email"
                placeholder="manager@foreverhotel.com"
                className="w-full border border-gray-200 rounded-md pl-9 pr-3 py-2 text-[11px] text-black placeholder:text-black/30 focus:outline-none focus:border-black"
                {...register("email")}
              />
            </div>
            {errors.email && (
              <p className="font-normal text-[9.5px] text-red-600 mt-1">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label
              className="font-normal text-[10px] text-black/60 block mb-1"
              htmlFor="password"
            >
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-4 w-4 text-black/40" />
              </div>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                className="w-full border border-gray-200 rounded-md pl-9 pr-3 py-2 text-[11px] text-black placeholder:text-black/30 focus:outline-none focus:border-black"
                {...register("password")}
              />
            </div>
            {errors.password && (
              <p className="font-normal text-[9.5px] text-red-600 mt-1">
                {errors.password.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-black text-white rounded-md py-2 mt-2 font-medium text-[11px] flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                Sign in
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
