/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
import { 
  Mic, 
  Square, 
  Play, 
  Pause, 
  Trash2, 
  Sparkles, 
  Volume2, 
  MessageSquare,
  Loader2,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Types
interface Message {
  id: string;
  originalAudioUrl: string;
  transcription?: string;
  coveredAudioUrl?: string;
  voiceName?: string;
  timestamp: number;
  status: 'idle' | 'transcribing' | 'covering' | 'ready' | 'error';
}

const VOICES = [
  { id: 'Puck', name: 'Puck (Playful)', description: 'A energetic and playful voice' },
  { id: 'Charon', name: 'Charon (Deep)', description: 'A deep and authoritative voice' },
  { id: 'Kore', name: 'Kore (Soft)', description: 'A gentle and soft voice' },
  { id: 'Fenrir', name: 'Fenrir (Bold)', description: 'A strong and bold voice' },
  { id: 'Zephyr', name: 'Zephyr (Smooth)', description: 'A smooth and calm voice' },
];

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].id);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const aiRef = useRef<GoogleGenAI | null>(null);

  // Initialize Gemini
  useEffect(() => {
    if (process.env.GEMINI_API_KEY) {
      aiRef.current = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
  }, []);

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecordingTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        const newMessage: Message = {
          id: crypto.randomUUID(),
          originalAudioUrl: audioUrl,
          timestamp: Date.now(),
          status: 'idle'
        };
        
        setMessages((prev) => [newMessage, ...prev]);
        autoTranscribe(newMessage, audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setError(null);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  const autoTranscribe = async (message: Message, audioBlob: Blob) => {
    if (!aiRef.current) return;

    setMessages(prev => prev.map(m => m.id === message.id ? { ...m, status: 'transcribing' } : m));

    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        
        const response = await aiRef.current!.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: {
            parts: [
              { inlineData: { data: base64Data, mimeType: 'audio/webm' } },
              { text: "Transcribe this audio message accurately. Return only the transcription." }
            ]
          }
        });

        const transcription = response.text || "Could not transcribe.";
        setMessages(prev => prev.map(m => m.id === message.id ? { ...m, transcription, status: 'idle' } : m));
      };
    } catch (err) {
      console.error("Transcription error:", err);
      setMessages(prev => prev.map(m => m.id === message.id ? { ...m, status: 'error' } : m));
    }
  };

  const applyVoiceCover = async (message: Message, voiceId: string) => {
    if (!aiRef.current || !message.transcription) return;

    setMessages(prev => prev.map(m => m.id === message.id ? { ...m, status: 'covering', voiceName: voiceId } : m));

    try {
      const response = await aiRef.current!.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: message.transcription }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceId as any },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        
        // Create WAV header for 24kHz Mono 16-bit PCM
        const wavHeader = createWavHeader(bytes.length, 24000);
        const wavBlob = new Blob([wavHeader, bytes], { type: 'audio/wav' });
        const coveredAudioUrl = URL.createObjectURL(wavBlob);
        
        setMessages(prev => prev.map(m => m.id === message.id ? { 
          ...m, 
          coveredAudioUrl, 
          status: 'ready' 
        } : m));
      }
    } catch (err) {
      console.error("Voice cover error:", err);
      setMessages(prev => prev.map(m => m.id === message.id ? { ...m, status: 'error' } : m));
    }
  };

  // Helper to create a WAV header for raw PCM data
  const createWavHeader = (pcmLength: number, sampleRate: number) => {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    // RIFF identifier
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + pcmLength, true); // file length
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // fmt chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // length of fmt chunk
    view.setUint16(20, 1, true); // audio format (1 = PCM)
    view.setUint16(22, 1, true); // number of channels (1 = mono)
    view.setUint32(24, sampleRate, true); // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * channels * bitsPerSample/8)
    view.setUint16(32, 2, true); // block align (channels * bitsPerSample/8)
    view.setUint16(34, 16, true); // bits per sample

    // data chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, pcmLength, true); // length of data chunk

    return buffer;
  };

  const deleteMessage = (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 bg-black/50 backdrop-blur-xl border-b border-white/10 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Voice Cover
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 text-xs font-mono text-white/40 uppercase tracking-widest">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live Processing
          </div>
        </div>
      </header>

      <main className="pt-24 pb-40 px-4 max-w-3xl mx-auto">
        {/* Voice Selection */}
        <section className="mb-12">
          <h2 className="text-xs font-mono text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Volume2 className="w-3 h-3" /> Select AI Voice Cover
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {VOICES.map((voice) => (
              <button
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className={`p-3 rounded-xl border transition-all duration-300 text-left group ${
                  selectedVoice === voice.id
                    ? "bg-orange-500 border-orange-400 text-white shadow-lg shadow-orange-500/20"
                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:border-white/20"
                }`}
              >
                <div className="text-sm font-bold mb-1">{voice.name.split(' ')[0]}</div>
                <div className={`text-[10px] leading-tight ${selectedVoice === voice.id ? "text-white/80" : "text-white/40"}`}>
                  {voice.description.split(' ').slice(0, 2).join(' ')}...
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Messages List */}
        <section className="space-y-6">
          <AnimatePresence mode="popLayout">
            {messages.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-20 text-center"
              >
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <MessageSquare className="w-8 h-8 text-white/20" />
                </div>
                <p className="text-white/40 font-medium">No messages yet. Start recording to create a cover.</p>
              </motion.div>
            ) : (
              messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, x: -20 }}
                  className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden"
                >
                  <div className="p-5">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                          <Mic className="w-5 h-5 text-white/60" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white/80">Original Recording</div>
                          <div className="text-[10px] text-white/40 font-mono">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => deleteMessage(msg.id)}
                        className="p-2 text-white/20 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center gap-4 bg-black/20 p-3 rounded-xl mb-4">
                      <audio src={msg.originalAudioUrl} controls className="w-full h-8 brightness-90 invert grayscale" />
                    </div>

                    {msg.transcription && (
                      <div className="mb-4">
                        <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Transcription</div>
                        <p className="text-sm text-white/70 leading-relaxed italic">"{msg.transcription}"</p>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-4 border-t border-white/5">
                      <div className="flex items-center gap-2">
                        {msg.status === 'transcribing' && (
                          <div className="flex items-center gap-2 text-xs text-orange-400">
                            <Loader2 className="w-3 h-3 animate-spin" /> Transcribing...
                          </div>
                        )}
                        {msg.status === 'covering' && (
                          <div className="flex items-center gap-2 text-xs text-orange-400">
                            <Loader2 className="w-3 h-3 animate-spin" /> Applying {msg.voiceName} Cover...
                          </div>
                        )}
                        {msg.status === 'ready' && (
                          <div className="flex items-center gap-2 text-xs text-green-400">
                            <CheckCircle2 className="w-3 h-3" /> Cover Ready
                          </div>
                        )}
                        {msg.status === 'error' && (
                          <div className="flex items-center gap-2 text-xs text-red-400">
                            <AlertCircle className="w-3 h-3" /> Processing Failed
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => applyVoiceCover(msg, selectedVoice)}
                        disabled={msg.status !== 'idle' || !msg.transcription}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${
                          msg.status === 'idle' && msg.transcription
                            ? "bg-white text-black hover:bg-orange-500 hover:text-white"
                            : "bg-white/5 text-white/20 cursor-not-allowed"
                        }`}
                      >
                        <Sparkles className="w-3 h-3" /> Apply {selectedVoice} Cover
                      </button>
                    </div>

                    {msg.coveredAudioUrl && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="mt-4 pt-4 border-t border-white/5"
                      >
                        <div className="text-[10px] font-mono text-orange-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                          <Volume2 className="w-3 h-3" /> {msg.voiceName} Cover Output
                        </div>
                        <div className="flex items-center gap-4 bg-orange-500/10 p-3 rounded-xl border border-orange-500/20">
                          <audio src={msg.coveredAudioUrl} controls className="w-full h-8 brightness-110 hue-rotate-180" />
                        </div>
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </section>
      </main>

      {/* Recording Controls */}
      <div className="fixed bottom-0 w-full p-8 flex justify-center pointer-events-none">
        <div className="bg-black/80 backdrop-blur-2xl border border-white/10 rounded-full p-4 flex items-center gap-6 shadow-2xl pointer-events-auto">
          {isRecording && (
            <div className="flex items-center gap-3 px-4 border-r border-white/10">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-mono font-bold text-white/80">{formatTime(recordingTime)}</span>
            </div>
          )}
          
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 group relative ${
              isRecording 
                ? "bg-red-500 shadow-lg shadow-red-500/40" 
                : "bg-white hover:bg-orange-500 shadow-lg shadow-white/10"
            }`}
          >
            {isRecording ? (
              <Square className="w-6 h-6 text-white fill-current" />
            ) : (
              <Mic className="w-6 h-6 text-black group-hover:text-white transition-colors" />
            )}
            
            {/* Recording Animation Rings */}
            {isRecording && (
              <>
                <div className="absolute inset-0 rounded-full border-2 border-red-500 animate-ping opacity-20" />
                <div className="absolute -inset-2 rounded-full border border-red-500/20 animate-pulse" />
              </>
            )}
          </button>

          <div className="pr-4 text-xs font-medium text-white/40 max-w-[120px] leading-tight">
            {isRecording ? "Tap to stop recording" : "Tap to record your message"}
          </div>
        </div>
      </div>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-32 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-full text-sm font-bold shadow-xl flex items-center gap-2 z-[100]"
          >
            <AlertCircle className="w-4 h-4" /> {error}
            <button onClick={() => setError(null)} className="ml-2 hover:opacity-70">×</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
