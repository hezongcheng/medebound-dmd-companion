import { t, translateText, contentText, getLocale } from '../i18n/runtime';
import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, Maximize, Minimize } from 'lucide-react';

interface Video {
  id: string;
  title: string;
  description?: string;
  videoUrl: string;
  thumbnailUrl?: string;
}

interface Props {
  videos: Video[];
}

export const VideoCarousel: React.FC<Props> = ({ videos }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoPlayRef = useRef<NodeJS.Timeout | null>(null);
  const hideControlsTimer = useRef<NodeJS.Timeout | null>(null);

  // 自动轮播（仅在不播放视频且不悬停时）
  useEffect(() => {
    if (!isPlaying && !isHovered && videos.length > 1) {
      autoPlayRef.current = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % videos.length);
      }, 5000);
    }
    return () => {
      if (autoPlayRef.current) {
        clearInterval(autoPlayRef.current);
      }
    };
  }, [isPlaying, isHovered, videos.length]);

  // 切换视频时重置播放状态
  useEffect(() => {
    setIsPlaying(false);
    setThumbnailError(false);
    setVideoError(false);
    setShowControls(true);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [currentIndex]);

  // 播放时自动隐藏控件
  useEffect(() => {
    if (isPlaying && !isHovered) {
      hideControlsTimer.current = setTimeout(() => {
        setShowControls(false);
      }, 2000);
    } else {
      setShowControls(true);
    }
    return () => {
      if (hideControlsTimer.current) {
        clearTimeout(hideControlsTimer.current);
      }
    };
  }, [isPlaying, isHovered]);

  // 监听全屏变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev - 1 + videos.length) % videos.length);
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % videos.length);
  };

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleToggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('全屏切换失败:', err);
    }
  };

  const handleVideoClick = () => {
    handlePlayPause();
    // 点击后短暂显示控件
    setShowControls(true);
  };

  const handleVideoEnd = () => {
    setIsPlaying(false);
    // 视频播放结束后自动切换到下一个
    if (videos.length > 1) {
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % videos.length);
      }, 1000);
    }
  };

  if (videos.length === 0) {
    return null;
  }

  const currentVideo = videos[currentIndex];

  // 控件是否可见
  const controlsVisible = showControls || isHovered || !isPlaying;

  return (
    <div 
      ref={containerRef}
      className={`relative bg-gradient-to-br from-gray-900 via-gray-800 to-brand-900 overflow-hidden shadow-xl ${isFullscreen ? 'rounded-none' : 'rounded-2xl h-full'}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseMove={() => {
        setShowControls(true);
        if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
        if (isPlaying) {
          hideControlsTimer.current = setTimeout(() => setShowControls(false), 2500);
        }
      }}
    >
      {/* 视频容器 */}
      <div className={`relative w-full min-h-0 ${isFullscreen ? 'h-full' : 'aspect-video lg:aspect-auto lg:h-full'}`}>
        {/* 封面图片作为背景（当视频未播放时显示） */}
        {!isPlaying && currentVideo.thumbnailUrl && !thumbnailError && (
          <img
            src={currentVideo.thumbnailUrl}
            alt={translateText(currentVideo.title)}
            className="absolute inset-0 w-full h-full object-cover z-10"
            onError={() => setThumbnailError(true)}
          />
        )}
        
        {/* 备用背景（当封面加载失败时） */}
        {!isPlaying && (thumbnailError || !currentVideo.thumbnailUrl) && (
          <div className="absolute inset-0 bg-gradient-to-br from-brand-700 via-brand-800 to-gray-900 flex items-center justify-center z-10">
            <div className="text-center text-white/60">
              <Play className="w-16 h-16 mx-auto mb-2 opacity-30" />
            </div>
          </div>
        )}
        
        <video
          ref={videoRef}
          src={currentVideo.videoUrl}
          poster={currentVideo.thumbnailUrl}
          className={`w-full h-full ${isFullscreen ? 'object-contain' : 'object-cover'}`}
          onEnded={handleVideoEnd}
          onError={() => setVideoError(true)}
          onClick={handleVideoClick}
          playsInline
          style={{ cursor: 'pointer' }}
        />
        
        {/* 渐变遮罩 - 仅在控件可见时显示 */}
        <div className={`absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 pointer-events-none z-20 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`} />
        
        {/* 中央播放按钮 - 仅在未播放时显示；播放中完全隐藏，用户点击视频本身即可暂停 */}
        {!isPlaying && (
          <div
            className="absolute inset-0 flex items-center justify-center z-30 cursor-pointer"
            onClick={handlePlayPause}
          >
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center transition-all duration-300 hover:bg-white/30 hover:scale-110">
              <Play className="w-7 h-7 sm:w-8 sm:h-8 text-white ml-1" />
            </div>
          </div>
        )}

        {/* 视频信息 */}
        <div className={`absolute bottom-0 left-0 right-0 p-4 sm:p-6 z-20 pointer-events-none transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>
          <h3 className="text-white font-bold text-lg sm:text-xl mb-1 line-clamp-1">
            {translateText(currentVideo.title)}
          </h3>
          {currentVideo.description && (
            <p className="text-white/70 text-sm line-clamp-2 hidden sm:block">
              {translateText(currentVideo.description)}
            </p>
          )}
        </div>

        {/* 全屏按钮 */}
        <button
          onClick={handleToggleFullscreen}
          className={`absolute top-3 right-3 sm:top-4 sm:right-4 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-all hover:scale-110 z-30 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          title={translateText(isFullscreen ? '退出全屏' : '全屏播放')}
        >
          {isFullscreen ? (
            <Minimize className="w-4 h-4" />
          ) : (
            <Maximize className="w-4 h-4" />
          )}
        </button>

        {/* 左右切换按钮 */}
        {videos.length > 1 && (
          <>
            <button
              onClick={handlePrev}
              className={`absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/50 transition-all hover:scale-110 z-30 ${controlsVisible && isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={handleNext}
              className={`absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/50 transition-all hover:scale-110 z-30 ${controlsVisible && isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      {/* 指示器 */}
      {videos.length > 1 && (
        <div className={`absolute bottom-4 sm:bottom-6 right-4 sm:right-6 flex items-center gap-1.5 z-30 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>
          {videos.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                index === currentIndex 
                  ? 'w-6 bg-brand-400' 
                  : 'w-1.5 bg-white/40 hover:bg-white/60'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};
