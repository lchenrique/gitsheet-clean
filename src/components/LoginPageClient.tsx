"use client";

import { Clock, GitCommit, Github } from "lucide-react";
import { motion } from "framer-motion";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export default function LoginPageClient() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 flex flex-col items-center gap-8 max-w-md px-6 text-center"
      >
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center glow-primary"
        >
          <Clock className="w-10 h-10 text-primary" />
        </motion.div>

        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">
            <span className="text-gradient">GitSheet</span>
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Gere seu timesheet automaticamente a partir dos seus commits do GitHub.
          </p>
        </div>

        <div className="grid gap-3 w-full">
          {[
            { icon: GitCommit, text: "Busca commits automaticamente" },
            { icon: Clock, text: "Gera entradas de timesheet por dia" },
            { icon: Github, text: "Conecta com seus repositórios" },
          ].map((feature, index) => (
            <motion.div
              key={feature.text}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
              className="flex items-center gap-3 glass-card px-4 py-3 text-left"
            >
              <feature.icon className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm text-secondary-foreground">{feature.text}</span>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="w-full"
        >
          <Button
            onClick={() => signIn("github", { callbackUrl: "/repos" })}
            size="lg"
            className="w-full gap-3 text-base font-semibold h-12"
          >
            <Github className="w-5 h-5" />
            Entrar com GitHub
          </Button>
        </motion.div>

        <p className="text-xs text-muted-foreground">Acesso somente leitura aos seus repositórios.</p>
      </motion.div>
    </div>
  );
}
