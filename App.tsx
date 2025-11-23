
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { LESSONS, VOCABULARY_DATA, AI_CONVERSATION_PROMPTS } from './constants';
import type { Lesson, VocabularyWord } from './types';

// Make TypeScript aware of the HanziWriter library loaded from the CDN
declare const HanziWriter: any;

// Define updated SUB_LESSONS locally to include new sections
const SUB_LESSONS: string[] = ['Từ mới', 'Gõ từ mới', 'Từ mới SS', 'Ngữ pháp', 'Gõ bài khóa', 'Giao tiếp', 'AI giao tiếp', 'Bài tập'];

// --- Gemini Live API Audio Helper Functions ---
function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

// --- UI Components ---

interface SubLessonButtonProps {
  label: string;
  onClick: (label: string) => void;
  isActive: boolean;
}

const SubLessonButton: React.FC<SubLessonButtonProps> = ({ label, onClick, isActive }) => {
    const activeClasses = isActive
    ? 'bg-green-600 ring-2 ring-offset-1 ring-green-400 ring-offset-gray-50'
    : 'bg-green-500 hover:bg-green-600';

  return (
    <button
      onClick={() => onClick(label)}
      className={`
        flex-shrink-0 px-2 py-1 rounded-md font-semibold text-white shadow-sm transition-all 
        text-xs
        duration-300 ease-in-out transform hover:-translate-y-0.5
        focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-75
        ${activeClasses}
      `}
      aria-pressed={isActive}
    >
      {label}
    </button>
  );
};

interface HanziWriterModalProps {
  char: string | null;
  onClose: () => void;
}

const HanziWriterModal: React.FC<HanziWriterModalProps> = ({ char, onClose }) => {
  const writerRef = useRef<any>(null);
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (char && targetRef.current) {
      targetRef.current.innerHTML = ''; 
      writerRef.current = HanziWriter.create(targetRef.current, char, {
        width: 250,
        height: 250,
        padding: 5,
        showOutline: true,
        strokeAnimationSpeed: 1.2,
        delayBetweenStrokes: 150,
        strokeColor: '#f97316',
        radicalColor: '#38bdf8',
      });
      writerRef.current.animateCharacter();
    }
  }, [char]);

  if (!char) return null;

  const handleAnimate = () => writerRef.current?.animateCharacter();
  const handleQuiz = () => writerRef.current?.quiz();

  return (
    <div 
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in-fast"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div 
        className="bg-white rounded-2xl p-6 sm:p-8 shadow-2xl flex flex-col items-center justify-center gap-6 border-2 border-orange-400 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div ref={targetRef} className="bg-white rounded-lg"></div>
        <div className="flex gap-4">
           <button onClick={handleAnimate} className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors">Tập viết lại</button>
           <button onClick={handleQuiz} className="px-6 py-2 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-lg transition-colors">Luyện tập</button>
        </div>
        <button 
          onClick={onClose} 
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-800 transition-colors"
          aria-label="Đóng"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
};

interface VocabularyListProps {
  words: VocabularyWord[];
  onCharClick: (char: string) => void;
}

const VocabularyList: React.FC<VocabularyListProps> = ({ words, onCharClick }) => {
  const handlePlaySound = useCallback((text: string) => {
    const audio = new Audio(`/audio/${text}.mp3`);
    audio.play().catch(() => {
        // Fallback to TTS
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'zh-CN';
            utterance.rate = 0.9;
            window.speechSynthesis.speak(utterance);
        }
    });
  }, []);

  const isHanzi = (char: string) => /[\u4e00-\u9fff]/.test(char);

  return (
    <div className="w-full text-left flex flex-col h-full">
      <div className="grid grid-cols-3 gap-x-4 px-4 py-2 font-bold text-orange-500 border-b-2 border-orange-300 flex-shrink-0">
        <span>Chữ Hán</span>
        <span>Pinyin</span>
        <span>Nghĩa</span>
      </div>
      <div className="flex-grow overflow-y-auto custom-scrollbar pr-2">
        {words.map((word) => (
          <div
            key={word.id}
            onClick={() => handlePlaySound(word.char)}
            className="grid grid-cols-3 gap-x-4 items-center px-4 py-3 border-b border-gray-200 hover:bg-orange-50 transition-colors duration-200 rounded-md cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={`Phát âm và xem chi tiết từ ${word.char}`}
          >
            <div className="flex flex-wrap">
              {word.char.split('').map((char, index) => {
                const canAnimate = isHanzi(char);
                return (
                  <span
                    key={index}
                    onClick={(e) => {
                      if (canAnimate) {
                        e.stopPropagation();
                        onCharClick(char);
                      }
                    }}
                    className={`font-semibold text-lg text-gray-800 ${canAnimate ? 'cursor-pointer hover:text-orange-500 transition-colors' : 'cursor-default'}`}
                    role={canAnimate ? "button" : undefined}
                    tabIndex={canAnimate ? 0 : -1}
                    aria-label={canAnimate ? `Tập viết chữ ${char}` : undefined}
                  >
                    {char}
                  </span>
                );
              })}
            </div>
            <span className="text-gray-500">{word.pinyin}</span>
            <span className="text-gray-700">{word.vi}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

interface TypingExerciseProps {
  words: VocabularyWord[];
  type: 'Gõ từ mới' | 'Gõ bài khóa';
}

const TypingExercise: React.FC<TypingExerciseProps> = ({ words, type }) => {
  const [shuffledWords, setShuffledWords] = useState<VocabularyWord[]>([]);
  const [userInputs, setUserInputs] = useState<Record<number, string>>({});
  const [score, setScore] = useState(0);

  const shuffleAndReset = useCallback(() => {
    const shuffled = [...words].sort(() => Math.random() - 0.5);
    setShuffledWords(shuffled);
    setUserInputs({});
    setScore(0);
  }, [words]);

  useEffect(() => {
    shuffleAndReset();
  }, [shuffleAndReset]);

  useEffect(() => {
    let currentScore = 0;
    shuffledWords.forEach(word => {
      const input = userInputs[word.id];
      if (input === undefined || input === '') {
        // Untouched, 0 points
      } else if (input === word.char) {
        currentScore += 1; // Correct, +1
      } else {
        currentScore -= 1; // Incorrect, -1
      }
    });
    setScore(currentScore);
  }, [userInputs, shuffledWords]);

  const handleInputChange = (wordId: number, value: string) => {
    setUserInputs(prev => ({ ...prev, [wordId]: value.trim() }));
  };

  const getInputClassName = (word: VocabularyWord, inputValue: string | undefined) => {
    if (!inputValue || inputValue === '') {
      return 'border-gray-300 focus:border-orange-500 focus:ring-orange-500';
    }
    if (inputValue === word.char) {
      return 'border-green-500 bg-green-50 text-green-700 ring-2 ring-green-500';
    }
    return 'border-red-500 bg-red-50 text-red-700 ring-2 ring-red-500';
  };

  const isHanziPrompt = type === 'Gõ bài khóa';

  return (
    <div className="w-full text-left flex flex-col h-full">
      <div className="text-center mb-4 flex-shrink-0">
        <p className="text-lg font-bold text-gray-700">
          Điểm: <span className={`transition-colors duration-300 ${score > 0 ? 'text-green-600' : score < 0 ? 'text-red-600' : 'text-sky-600'}`}>{score}</span>
        </p>
      </div>

      <div className="flex-grow overflow-y-auto space-y-6 custom-scrollbar pr-3 -mr-3">
        {shuffledWords.map((word) => (
          <div key={word.id} className="grid grid-cols-1 gap-2">
            <label 
              htmlFor={`word-${word.id}`} 
              className={`
                ${isHanziPrompt 
                  ? 'text-center text-base font-semibold text-sky-700' 
                  : 'text-left text-lg text-gray-600'}
              `}
            >
              {isHanziPrompt ? word.char : word.vi}
            </label>
            <input
              id={`word-${word.id}`}
              type="text"
              value={userInputs[word.id] || ''}
              onChange={(e) => handleInputChange(word.id, e.target.value)}
              className={`
                w-full p-3 bg-white border-2 rounded-lg text-gray-800 text-xl
                transition-all duration-300 focus:outline-none focus:ring-2
                ${isHanziPrompt ? 'text-center' : ''}
                ${getInputClassName(word, userInputs[word.id])}
              `}
              autoComplete="off"
              aria-label={`Nhập chữ Hán cho "${isHanziPrompt ? word.char : word.vi}"`}
            />
          </div>
        ))}
      </div>
      <div className="mt-6 text-center flex-shrink-0">
        <button
          onClick={shuffleAndReset}
          className="px-4 py-1.5 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-lg shadow transition-transform transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-opacity-75"
        >
          Làm lại
        </button>
      </div>
    </div>
  );
};

interface GiaoTiepExerciseProps {
  words: VocabularyWord[];
}

const GiaoTiepExercise: React.FC<GiaoTiepExerciseProps> = ({ words }) => {
  const [activeId, setActiveId] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const handlePlaySound = useCallback((text: string) => {
    const audio = new Audio(`/audio/${text}.mp3`);
    audio.play().catch(() => {
        // Fallback to TTS
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'zh-CN';
            utterance.rate = 0.9;
            window.speechSynthesis.speak(utterance);
        }
    });
  }, []);

  const handleShowDetails = useCallback((id: number) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setActiveId(id);
    timerRef.current = window.setTimeout(() => {
      setActiveId(null);
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <div className="w-full text-center space-y-4 h-full overflow-y-auto custom-scrollbar pr-3 -mr-3">
      {words.map((word) => (
        <div key={word.id} className="relative">
          <button
            onClick={() => {
              handleShowDetails(word.id);
              handlePlaySound(word.char);
            }}
            className="w-full text-lg p-3 bg-white border border-gray-300 rounded-lg text-gray-800 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400"
            aria-label={`Phát âm và hiển thị chi tiết cho "${word.vi}"`}
          >
            {word.vi}
          </button>
          {activeId === word.id && (
            <div className="mt-2 p-3 bg-gray-100 rounded-lg animate-fade-in-down">
              <p
                className="text-2xl font-bold text-orange-500 cursor-pointer"
                onClick={() => handlePlaySound(word.char)}
                aria-label={`Phát âm ${word.char}`}
                role="button"
                tabIndex={0}
              >
                {word.char}
              </p>
              <p className="text-lg text-sky-600 mt-1">{word.pinyin}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// --- Lesson Selector Modal ---
interface LessonSelectorModalProps {
  lessons: Lesson[];
  activeLessonId: number;
  onSelect: (id: number) => void;
  onClose: () => void;
}

const LessonSelectorModal: React.FC<LessonSelectorModalProps> = ({ lessons, activeLessonId, onSelect, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 pt-16" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-11/12 max-w-lg overflow-hidden animate-fade-in-down transform transition-all" onClick={e => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-3 flex justify-between items-center">
          <h3 className="text-white font-bold text-lg">Chọn bài học</h3>
          <button onClick={onClose} className="text-white hover:bg-white/20 rounded-full p-1 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {lessons.map((lesson) => (
            <button
              key={lesson.id}
              onClick={() => {
                onSelect(lesson.id);
                onClose();
              }}
              className={`
                py-3 px-2 rounded-lg font-bold text-sm transition-all duration-200 shadow-sm border
                ${activeLessonId === lesson.id 
                  ? 'bg-orange-500 text-white border-orange-600 shadow-md transform scale-105' 
                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-orange-100 hover:text-orange-600 hover:border-orange-200'}
              `}
            >
              {lesson.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- Settings Modal ---
interface SettingsModalProps {
  currentApiKey: string;
  onSave: (key: string) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ currentApiKey, onSave, onClose }) => {
  const [key, setKey] = useState(currentApiKey);

  const handleSave = () => {
    onSave(key);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast" onClick={onClose}>
       <div className="bg-white rounded-xl p-6 w-11/12 max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold mb-4 text-gray-800">Cài đặt API Key</h3>
          <p className="text-sm text-gray-500 mb-4">Nhập Google Gemini API Key của bạn để sử dụng tính năng AI. Key sẽ được lưu trên thiết bị này.</p>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Nhập API Key..."
            className="w-full border border-gray-300 rounded-lg p-2 mb-4 focus:ring-2 focus:ring-orange-500 outline-none"
          />
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Hủy</button>
            <button onClick={handleSave} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors">Lưu</button>
          </div>
       </div>
    </div>
  )
}

// --- Help Modal ---
interface HelpModalProps {
  onClose: () => void;
}

const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast" onClick={onClose}>
       <div className="bg-white rounded-xl p-6 w-11/12 max-w-xs shadow-2xl flex flex-col gap-3" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-gray-800 text-center mb-2">Trợ giúp</h3>
          <a 
            href="https://vnexpress.net/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="block w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg text-center transition-colors shadow-sm"
          >
            Liên hệ zalo
          </a>
          <a 
            href="https://vnexpress.net/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="block w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg text-center transition-colors shadow-sm"
          >
            Hướng dẫn sử dụng
          </a>
          <button 
            onClick={onClose} 
            className="mt-2 py-2 w-full text-gray-500 hover:bg-gray-100 rounded-lg transition-colors text-sm"
          >
            Đóng
          </button>
       </div>
    </div>
  );
};

// --- AI Conversation Component ---
type TranscriptItem = {
  id: number;
  speaker: 'user' | 'ai';
  text: string;
};

interface AIConversationProps {
  lessonName: string;
  apiKey: string;
}

const AIConversation: React.FC<AIConversationProps> = ({ lessonName, apiKey }) => {
    const [micState, setMicState] = useState<'idle' | 'requesting' | 'ready' | 'error'>('idle');
    const [status, setStatus] = useState('Đang chờ...');
    const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [liveSpeaker, setLiveSpeaker] = useState<'user' | 'ai' | null>(null);

    const sessionRef = useRef<any>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
    const nextStartTimeRef = useRef(0);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const liveSpeakerTimeoutRef = useRef<number | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement | null>(null);

    const scrollToBottom = useCallback(() => {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    useEffect(() => {
      scrollToBottom();
    }, [transcript, scrollToBottom]);
    
    const cleanup = useCallback(() => {
        console.log('Cleaning up AI Conversation...');
        if (sessionRef.current) {
            sessionRef.current.close();
            sessionRef.current = null;
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }

        inputAudioContextRef.current?.close().catch(console.error);
        inputAudioContextRef.current = null;

        outputAudioContextRef.current?.close().catch(console.error);
        outputAudioContextRef.current = null;
        
        if(window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
    }, []);
    
    // Effect for cleanup on component unmount
    useEffect(() => {
        return () => {
            cleanup();
        };
    }, [cleanup]);

    const startSession = async () => {
        setMicState('requesting');
        setError(null);

        const effectiveApiKey = apiKey || process.env.API_KEY;

        if (!effectiveApiKey) {
            setError('Chưa cấu hình API Key.');
            setMicState('error');
            return;
        }

        const prompts = AI_CONVERSATION_PROMPTS[lessonName];
        if (!prompts) {
            setError(`Nội dung cho bài "${lessonName}" chưa có sẵn.`);
            setMicState('error');
            return;
        }

        try {
            const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = localStream;
            setStatus('Đang kết nối tới AI...');
            setMicState('ready');

            const ai = new GoogleGenAI({ apiKey: effectiveApiKey });

            const questionList = prompts.map((p, i) => `${i + 1}. ${p}`).join('\n');
            const systemInstruction = `You are a Chinese language tutor for a Vietnamese speaker. Your task is to conduct a spoken practice session for lesson '${lessonName}'.

**Your Persona:**
- Friendly, patient, and encouraging.
- Speak Mandarin Chinese when asking questions and giving praise.
- Speak Vietnamese when giving instructions or corrections.

**Question List for this Session:**
${questionList}

**Conversation Flow:**
1.  **Start:** Greet the user in Vietnamese: "Chào bạn, chúng ta cùng luyện tập giao tiếp cho ${lessonName} nhé?" Then, wait for their response.
2.  **Ask First Question:** After they agree, ask the VERY FIRST question from the list in Mandarin Chinese.
3.  **Listen & Evaluate:** Listen to the user's spoken Chinese response. Their answer should be a grammatically correct and logical reply to your question.
4.  **If Correct:** Praise them briefly in Chinese (e.g., "很好!", "说得不错!"). Then, immediately ask the NEXT sequential question from the list in Chinese.
5.  **If Incorrect:**
    a. Switch to VIETNAMESE.
    b. Gently explain the mistake (e.g., "Câu trả lời chưa đúng lắm, bạn thử nói lại nhé." or explain a specific grammar error).
    c. Provide a correct example answer in Chinese, along with its Vietnamese translation.
    d. Switch back to Chinese and REPEAT the same question to give them another chance. Do not move to the next question until they answer the current one correctly.
6.  **End of Session:** After the LAST question is answered correctly, congratulate them in Vietnamese: "Rất tốt! Bạn đã hoàn thành bài luyện tập. Hẹn gặp lại lần sau!"

Proceed step-by-step through the question list. Do not skip questions.`;

            const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            inputAudioContextRef.current = inputAudioContext;
            const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            outputAudioContextRef.current = outputAudioContext;
            
            const outputNode = outputAudioContext.createGain();
            outputNode.connect(outputAudioContext.destination);

            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                  responseModalities: [Modality.AUDIO],
                  speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
                  },
                  systemInstruction: systemInstruction,
                },
                callbacks: {
                  onopen: () => {
                    setStatus('Đã kết nối! Bắt đầu nói chuyện...');
                    const source = inputAudioContext.createMediaStreamSource(localStream);
                    const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
                    scriptProcessorRef.current = scriptProcessor;
                    
                    scriptProcessor.onaudioprocess = (e) => {
                      const inputData = e.inputBuffer.getChannelData(0);
                      const pcmBlob = createBlob(inputData);
                      sessionPromise.then(session => {
                        session.sendRealtimeInput({ media: pcmBlob });
                      });
                    };
                    
                    source.connect(scriptProcessor);
                    scriptProcessor.connect(inputAudioContext.destination);
                  },
                  onmessage: async (msg: LiveServerMessage) => {
                    const { serverContent } = msg;
                    
                    const audioData = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                    if (audioData && outputAudioContextRef.current) {
                        const ctx = outputAudioContextRef.current;
                        const audioBuffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
                        const source = ctx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(outputNode);
                        
                        const currentTime = ctx.currentTime;
                        if (nextStartTimeRef.current < currentTime) {
                            nextStartTimeRef.current = currentTime;
                        }
                        source.start(nextStartTimeRef.current);
                        nextStartTimeRef.current += audioBuffer.duration;
                        
                        sourcesRef.current.add(source);
                        source.onended = () => {
                            sourcesRef.current.delete(source);
                        };
                    }

                    if (serverContent?.modelTurn && !serverContent.turnComplete) {
                         setLiveSpeaker('ai');
                         if (liveSpeakerTimeoutRef.current) clearTimeout(liveSpeakerTimeoutRef.current);
                         liveSpeakerTimeoutRef.current = window.setTimeout(() => setLiveSpeaker(null), 2000);
                    } else if (serverContent?.turnComplete) {
                         setLiveSpeaker(null);
                    }
                  },
                  onclose: () => {
                    setStatus('Đã ngắt kết nối.');
                    setMicState('idle');
                  },
                  onerror: (err) => {
                    console.error(err);
                    setError('Lỗi kết nối AI. Vui lòng kiểm tra API Key.');
                    setMicState('error');
                  }
                }
            });
            
            sessionRef.current = await sessionPromise;

        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Không thể khởi động ghi âm.');
            setMicState('error');
        }
    };

    const stopSession = () => {
      cleanup();
      setStatus('Đã dừng.');
      setMicState('idle');
    };

    return (
      <div className="flex flex-col h-full items-center justify-center p-4 space-y-6">
         <div className="text-center space-y-2">
             <h3 className="text-xl font-bold text-gray-700">AI Luyện Nói - {lessonName}</h3>
             <p className="text-gray-500 text-sm max-w-md mx-auto">
                Luyện tập trả lời các câu hỏi liên quan đến bài học với gia sư AI.
             </p>
         </div>

         <div className="flex flex-col items-center justify-center flex-grow w-full max-w-md space-y-8">
             {/* Status / Visualizer */}
             <div className={`
                w-48 h-48 rounded-full flex items-center justify-center border-4 transition-all duration-500 relative
                ${micState === 'ready' ? 'border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.3)]' : 
                  micState === 'error' ? 'border-red-500' : 'border-gray-200'}
             `}>
                {micState === 'ready' ? (
                    <div className="text-6xl animate-pulse">
                        {liveSpeaker === 'ai' ? '🤖' : '🎙️'}
                    </div>
                ) : (
                    <div className="text-6xl text-gray-300">
                        🎧
                    </div>
                )}
                
                {liveSpeaker === 'ai' && (
                    <div className="absolute -bottom-8 text-green-600 font-bold animate-bounce">
                        AI đang nói...
                    </div>
                )}
             </div>

             <div className="text-center min-h-[3rem]">
                 <p className={`font-medium text-lg ${micState === 'error' ? 'text-red-500' : 'text-gray-700'}`}>
                    {error || status}
                 </p>
             </div>

             {/* Controls */}
             <div className="flex gap-4">
                 {micState === 'idle' || micState === 'error' ? (
                     <button 
                        onClick={startSession}
                        className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-8 py-3 rounded-full font-bold text-lg shadow-lg transform transition hover:scale-105 flex items-center gap-2"
                     >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                        Bắt đầu
                     </button>
                 ) : (
                     <button 
                        onClick={stopSession}
                        className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-full font-bold text-lg shadow-lg transform transition hover:scale-105 flex items-center gap-2"
                     >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        Dừng lại
                     </button>
                 )}
             </div>
         </div>
         
         <div className="text-xs text-gray-400 max-w-xs text-center">
            Lưu ý: Hãy đảm bảo bạn đang ở nơi yên tĩnh và cho phép trình duyệt truy cập micro.
         </div>
      </div>
    );
};

const App: React.FC = () => {
  const [activeLessonId, setActiveLessonId] = useState<number>(LESSONS[0].id);
  const [activeSubLesson, setActiveSubLesson] = useState<string>(SUB_LESSONS[0]);
  const [selectedChar, setSelectedChar] = useState<string | null>(null);
  const [isLessonModalOpen, setIsLessonModalOpen] = useState(false);
  
  // Settings state
  const [userApiKey, setUserApiKey] = useState<string>(() => {
      return typeof localStorage !== 'undefined' ? localStorage.getItem('gemini_api_key') || '' : '';
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Help Modal state
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  const activeLessonName = LESSONS.find(l => l.id === activeLessonId)?.name || '';
  const lessonVocabulary = VOCABULARY_DATA[activeLessonName] || {};

  const handleSaveSettings = (key: string) => {
      setUserApiKey(key);
      localStorage.setItem('gemini_api_key', key);
      setIsSettingsOpen(false);
  };

  const renderContent = () => {
    switch (activeSubLesson) {
      case 'Từ mới':
        return <VocabularyList words={lessonVocabulary['Từ mới'] || []} onCharClick={setSelectedChar} />;
      case 'Gõ từ mới':
        return <TypingExercise words={lessonVocabulary['Gõ từ mới'] || []} type="Gõ từ mới" />;
      case 'Từ mới SS':
      case 'Ngữ pháp':
      case 'Bài tập':
         return (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                 </svg>
                 <p className="text-lg font-medium">Nội dung đang được cập nhật</p>
            </div>
         );
      case 'Gõ bài khóa':
        return <TypingExercise words={lessonVocabulary['Gõ bài khóa'] || []} type="Gõ bài khóa" />;
      case 'Giao tiếp':
        const lessonNumberMatch = activeLessonName.match(/\d+/);
        const lessonNumber = lessonNumberMatch ? parseInt(lessonNumberMatch[0], 10) : 0;
        
        if (lessonNumber >= 16 && lessonNumber <= 30) {
            const url = `https://tiengtrungbachai.online/trung1/gtb${lessonNumber}/gtb${lessonNumber}.html`;
            return (
                <div className="w-full h-full flex flex-col bg-white">
                    <iframe 
                        src={url} 
                        className="flex-grow w-full border-0"
                        title={`Giao tiếp - ${activeLessonName}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    />
                </div>
            );
        }
        
        return <GiaoTiepExercise words={lessonVocabulary['Giao tiếp'] || []} />;
      case 'AI giao tiếp':
        return <AIConversation lessonName={activeLessonName} apiKey={userApiKey} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-orange-50 font-sans text-gray-800">
      <header className="bg-orange-500 text-white py-2 shadow-md z-10 relative flex justify-center items-center flex-shrink-0">
        <button 
            onClick={() => setIsSettingsOpen(true)}
            className="absolute left-4 text-white hover:bg-white/20 rounded-full p-2 transition-colors top-1/2 -translate-y-1/2"
            aria-label="Cài đặt"
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
        </button>
        <h1 className="text-xl font-bold tracking-wide">Tiếng Trung AI</h1>
        <button 
          onClick={() => setIsLessonModalOpen(true)}
          className="absolute right-4 bg-white text-orange-600 px-4 py-1.5 rounded-full font-bold text-sm shadow hover:bg-gray-100 transition-colors flex items-center gap-2 top-1/2 -translate-y-1/2"
        >
          <span>{activeLessonName}</span>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
      </header>

      <div className="bg-green-500 p-2 overflow-x-auto flex gap-2 shadow-inner custom-scrollbar flex-shrink-0">
        {SUB_LESSONS.map((sub) => (
          <SubLessonButton
            key={sub}
            label={sub}
            onClick={setActiveSubLesson}
            isActive={activeSubLesson === sub}
          />
        ))}
      </div>

      <main className="flex-grow overflow-hidden p-4 relative">
        <div className="bg-white rounded-xl shadow-lg h-full w-full overflow-hidden border border-orange-200 p-2">
            {renderContent()}
        </div>
      </main>

      <footer className="py-2 text-center flex-shrink-0">
         <button 
           onClick={() => setIsHelpModalOpen(true)}
           className="text-gray-500 hover:text-orange-600 text-sm font-medium underline underline-offset-2 decoration-gray-300 hover:decoration-orange-500 transition-all"
         >
           Trợ giúp
         </button>
      </footer>

      {selectedChar && (
        <HanziWriterModal char={selectedChar} onClose={() => setSelectedChar(null)} />
      )}

      {isLessonModalOpen && (
        <LessonSelectorModal 
          lessons={LESSONS} 
          activeLessonId={activeLessonId} 
          onSelect={setActiveLessonId} 
          onClose={() => setIsLessonModalOpen(false)} 
        />
      )}

      {isSettingsOpen && (
        <SettingsModal 
            currentApiKey={userApiKey}
            onSave={handleSaveSettings}
            onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {isHelpModalOpen && (
        <HelpModal onClose={() => setIsHelpModalOpen(false)} />
      )}
    </div>
  );
};

export default App;
