import { useState, useEffect } from 'react';
import {
    X,
    Monitor,
    Gauge,
    Minimize2,
    Hand,
    Keyboard,
    Check,
    Battery,
    Zap,
    Signal,
    TrendingUp,
    Flame,
    Edit3,
    Smartphone,
    ChevronDown,
    Crosshair,
    MousePointer,
    RotateCcw,
    AlertTriangle,
} from 'lucide-react';

interface SettingsPanelProps {
    onClose: () => void;
    toolbarPosition?: 'top' | 'bottom';
    showDeviceSkin?: boolean;
    onShowDeviceSkinChange?: (show: boolean) => void;
    gradientColor1?: string;
    gradientColor2?: string;
    onGradientColor1Change?: (color1: string) => void;
    onGradientColor2Change?: (color2: string) => void;
    deviceSkinColor?: string;
    onDeviceSkinColorChange?: (color: string) => void;
    touchFeedback?: boolean;
    onTouchFeedbackChange?: (enabled: boolean) => void;
    quality?: string;
    onQualityChange?: (quality: string) => void;
    fps?: string;
    onFpsChange?: (fps: string) => void;
    bitrate?: string;
    onBitrateChange?: (bitrate: string) => void;
    cursorStyle?: 'crosshair' | 'default';
    onCursorStyleChange?: (style: 'crosshair' | 'default') => void;
    onResetSettings?: () => void;
}

export function SettingsPanel({
    onClose,
    showDeviceSkin = true,
    onShowDeviceSkinChange,
    gradientColor1 = 'rgba(238, 174, 202, 1)',
    gradientColor2 = 'rgba(148, 187, 233, 1)',
    onGradientColor1Change,
    onGradientColor2Change,
    deviceSkinColor = '#1a1a1a',
    onDeviceSkinColorChange,
    touchFeedback = true,
    onTouchFeedbackChange,
    quality = '1920',
    onQualityChange,
    fps = '60',
    onFpsChange,
    bitrate = '8',
    onBitrateChange,
    cursorStyle = 'crosshair',
    onCursorStyleChange,
    onResetSettings,
}: SettingsPanelProps) {
    const [localQuality, setLocalQuality] = useState(quality);
    const [localBitrate, setLocalBitrate] = useState(bitrate);
    const [showQualityDropdown, setShowQualityDropdown] = useState(false);
    const [showFPSDropdown, setShowFPSDropdown] = useState(false);
    const [showBitrateDropdown, setShowBitrateDropdown] = useState(false);
    const [keyMapping, setKeyMapping] = useState(false);
    const [showGradientPicker, setShowGradientPicker] = useState(false);
    const [showSkinColorPicker, setShowSkinColorPicker] = useState(false);
    const [showCursorDropdown, setShowCursorDropdown] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    // Sync local state with props
    useEffect(() => {
        setLocalQuality(quality);
    }, [quality]);

    useEffect(() => {
        setLocalBitrate(bitrate);
    }, [bitrate]);

    const handleQualitySave = () => {
        let value = parseInt(localQuality, 10);
        if (isNaN(value) || value < 720) {
            value = 720;
        }
        const qualityStr = value.toString();
        setLocalQuality(qualityStr);
        onQualityChange?.(qualityStr);
        setShowQualityDropdown(false);
    };

    const handleBitrateSave = () => {
        if (localBitrate && parseFloat(localBitrate) > 0) {
            onBitrateChange?.(localBitrate);
            setShowBitrateDropdown(false);
        }
    };

    const handleFpsChange = (newFps: string) => {
        onFpsChange?.(newFps);
        setShowFPSDropdown(false);
    };

    const fpsOptions = [
        {
            value: '30',
            label: '30 FPS',
            desc: 'Power saving',
            icon: Battery,
            color: 'var(--vsc-yellow)',
        },
        {
            value: '60',
            label: '60 FPS',
            desc: 'Standard',
            icon: Gauge,
            color: 'var(--vsc-green)',
        },
        {
            value: '90',
            label: '90 FPS',
            desc: 'High refresh',
            icon: Zap,
            color: 'var(--vsc-blue)',
        },
    ];

    const bitrateOptions = [
        {
            value: '8',
            label: '8 Mbps',
            desc: 'Standard quality',
            icon: Signal,
            color: 'var(--vsc-green)',
        },
        {
            value: '20',
            label: '20 Mbps',
            desc: 'High quality',
            icon: TrendingUp,
            color: 'var(--vsc-blue)',
        },
        {
            value: '40',
            label: '40 Mbps',
            desc: 'Ultra quality',
            icon: Flame,
            color: 'var(--vsc-purple)',
        },
    ];

    const cursorOptions = [
        {
            value: 'crosshair' as const,
            label: 'Crosshair',
            desc: 'Precise targeting',
            icon: Crosshair,
            color: 'var(--vsc-blue)',
        },
        {
            value: 'default' as const,
            label: 'Default',
            desc: 'Normal pointer',
            icon: MousePointer,
            color: 'var(--vsc-green)',
        },
    ];

    return (
        <div className="panel-overlay">
            <div className="panel-header">
                <span className="panel-title">Settings</span>
                <button className="panel-close-btn" onClick={onClose}>
                    <X size={14} />
                </button>
            </div>

            <div className="panel-content">
                {/* Settings Section */}
                <div className="settings-section">
                    {/* Quality Input */}
                    <div style={{ position: 'relative' }}>
                        <button
                            className="setting-item"
                            onClick={() => {
                                setShowQualityDropdown(!showQualityDropdown);
                                setShowFPSDropdown(false);
                                setShowBitrateDropdown(false);
                            }}
                        >
                            <div className="setting-info">
                                <Monitor className="setting-icon" size={16} />
                                <span className="setting-label">Quality (Max Size)</span>
                            </div>
                            <div className="setting-value">
                                <span>{quality}p</span>
                            </div>
                        </button>

                        {showQualityDropdown && (
                            <div className="dropdown-menu">
                                <div className="custom-input-section">
                                    <div className="custom-input-row">
                                        <div
                                            className="dropdown-item-icon"
                                            style={{
                                                background: 'rgba(75, 156, 75, 0.2)',
                                                width: 32,
                                                height: 32,
                                                color: 'var(--vsc-green)',
                                            }}
                                        >
                                            <Monitor size={12} />
                                        </div>
                                        <input
                                            type="number"
                                            className="custom-input"
                                            placeholder="1920"
                                            min={720}
                                            value={localQuality}
                                            onChange={(e) => setLocalQuality(e.target.value)}
                                            onKeyPress={(e) =>
                                                e.key === 'Enter' && handleQualitySave()
                                            }
                                        />
                                        <button
                                            className="btn"
                                            style={{ padding: '6px 12px', fontSize: '10px' }}
                                            onClick={handleQualitySave}
                                        >
                                            <Check size={8} />
                                            Save
                                        </button>
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 9,
                                            color: 'var(--vsc-text-muted)',
                                            marginTop: 6,
                                            marginLeft: 40,
                                        }}
                                    >
                                        Max resolution (min: 720, default: 1920)
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* FPS Dropdown */}
                    <div style={{ position: 'relative' }}>
                        <button
                            className="setting-item"
                            onClick={() => {
                                setShowFPSDropdown(!showFPSDropdown);
                                setShowQualityDropdown(false);
                                setShowBitrateDropdown(false);
                            }}
                        >
                            <div className="setting-info">
                                <Gauge className="setting-icon" size={16} />
                                <span className="setting-label">Frame Rate</span>
                            </div>
                            <div className="setting-value">
                                <span>{fpsOptions.find((f) => f.value === fps)?.label}</span>
                            </div>
                        </button>

                        {showFPSDropdown && (
                            <div className="dropdown-menu">
                                {fpsOptions.map((opt) => (
                                    <button
                                        key={opt.value}
                                        className="dropdown-item"
                                        onClick={() => handleFpsChange(opt.value)}
                                    >
                                        <div
                                            className="dropdown-item-icon"
                                            style={{
                                                background: `${opt.color}33`,
                                                color: opt.color,
                                            }}
                                        >
                                            <opt.icon size={12} />
                                        </div>
                                        <div className="dropdown-item-info">
                                            <div className="dropdown-item-label">{opt.label}</div>
                                            <div className="dropdown-item-desc">{opt.desc}</div>
                                        </div>
                                        {fps === opt.value && (
                                            <Check
                                                className="dropdown-item-check"
                                                size={12}
                                                style={{ color: opt.color }}
                                            />
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Bitrate Dropdown */}
                    <div style={{ position: 'relative' }}>
                        <button
                            className="setting-item"
                            onClick={() => {
                                setShowBitrateDropdown(!showBitrateDropdown);
                                setShowQualityDropdown(false);
                                setShowFPSDropdown(false);
                            }}
                        >
                            <div className="setting-info">
                                <Minimize2 className="setting-icon" size={16} />
                                <span className="setting-label">Bit Rate</span>
                            </div>
                            <div className="setting-value">
                                <span>{bitrate} Mbps</span>
                            </div>
                        </button>

                        {showBitrateDropdown && (
                            <div className="dropdown-menu">
                                {bitrateOptions.map((opt) => (
                                    <button
                                        key={opt.value}
                                        className="dropdown-item"
                                        onClick={() => {
                                            setLocalBitrate(opt.value);
                                            onBitrateChange?.(opt.value);
                                            setShowBitrateDropdown(false);
                                        }}
                                    >
                                        <div
                                            className="dropdown-item-icon"
                                            style={{
                                                background: `${opt.color}33`,
                                                color: opt.color,
                                            }}
                                        >
                                            <opt.icon size={12} />
                                        </div>
                                        <div className="dropdown-item-info">
                                            <div className="dropdown-item-label">{opt.label}</div>
                                            <div className="dropdown-item-desc">{opt.desc}</div>
                                        </div>
                                        {bitrate === opt.value && (
                                            <Check
                                                className="dropdown-item-check"
                                                size={12}
                                                style={{ color: opt.color }}
                                            />
                                        )}
                                    </button>
                                ))}

                                {/* Custom Input */}
                                <div className="custom-input-section">
                                    <div className="custom-input-row">
                                        <div
                                            className="dropdown-item-icon"
                                            style={{
                                                background: 'rgba(210, 153, 34, 0.2)',
                                                width: 32,
                                                height: 32,
                                                color: 'var(--vsc-yellow)',
                                            }}
                                        >
                                            <Edit3 size={12} />
                                        </div>
                                        <input
                                            type="number"
                                            className="custom-input"
                                            placeholder="Custom"
                                            value={localBitrate}
                                            onChange={(e) => setLocalBitrate(e.target.value)}
                                            onKeyPress={(e) =>
                                                e.key === 'Enter' && handleBitrateSave()
                                            }
                                        />
                                        <button
                                            className="btn"
                                            style={{ padding: '6px 12px', fontSize: '10px' }}
                                            onClick={handleBitrateSave}
                                        >
                                            <Check size={8} />
                                            Save
                                        </button>
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 9,
                                            color: 'var(--vsc-text-muted)',
                                            marginTop: 6,
                                            marginLeft: 40,
                                        }}
                                    >
                                        Enter value in Mbps
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Cursor Style Dropdown */}
                    <div style={{ position: 'relative' }}>
                        <button
                            className="setting-item"
                            onClick={() => {
                                setShowCursorDropdown(!showCursorDropdown);
                                setShowQualityDropdown(false);
                                setShowFPSDropdown(false);
                                setShowBitrateDropdown(false);
                            }}
                        >
                            <div className="setting-info">
                                {cursorStyle === 'crosshair' ? (
                                    <Crosshair className="setting-icon" size={16} />
                                ) : (
                                    <MousePointer className="setting-icon" size={16} />
                                )}
                                <span className="setting-label">Cursor Style</span>
                            </div>
                            <div className="setting-value">
                                <span>
                                    {cursorOptions.find((c) => c.value === cursorStyle)?.label}
                                </span>
                            </div>
                        </button>

                        {showCursorDropdown && (
                            <div className="dropdown-menu">
                                {cursorOptions.map((opt) => (
                                    <button
                                        key={opt.value}
                                        className="dropdown-item"
                                        onClick={() => {
                                            onCursorStyleChange?.(opt.value);
                                            setShowCursorDropdown(false);
                                        }}
                                    >
                                        <div
                                            className="dropdown-item-icon"
                                            style={{
                                                background: `${opt.color}33`,
                                                color: opt.color,
                                            }}
                                        >
                                            <opt.icon size={12} />
                                        </div>
                                        <div className="dropdown-item-info">
                                            <div className="dropdown-item-label">{opt.label}</div>
                                            <div className="dropdown-item-desc">{opt.desc}</div>
                                        </div>
                                        {cursorStyle === opt.value && (
                                            <Check
                                                className="dropdown-item-check"
                                                size={12}
                                                style={{ color: opt.color }}
                                            />
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Toggle Options */}
                    <button
                        className="setting-item"
                        onClick={() => onTouchFeedbackChange?.(!touchFeedback)}
                    >
                        <div className="setting-info">
                            <Hand className="setting-icon" size={16} />
                            <span className="setting-label">Touch Input</span>
                        </div>
                        <div
                            className={`toggle-switch ${touchFeedback ? 'active' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onTouchFeedbackChange?.(!touchFeedback);
                            }}
                        >
                            <div className="toggle-knob" />
                        </div>
                    </button>

                    <button className="setting-item" onClick={() => setKeyMapping(!keyMapping)}>
                        <div className="setting-info">
                            <Keyboard className="setting-icon" size={16} />
                            <span className="setting-label">Key Mapping</span>
                        </div>
                        <div
                            className={`toggle-switch ${keyMapping ? 'active' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setKeyMapping(!keyMapping);
                            }}
                        >
                            <div className="toggle-knob" />
                        </div>
                    </button>

                    {/* Audio forward toggle is disabled until implementation */}
                    {/*
          <button
            className="setting-item"
            onClick={() => setAudioForward(!audioForward)}
          >
            <div className="setting-info">
              <Volume2 className="setting-icon" size={16} />
              <span className="setting-label">Audio Forward</span>
            </div>
            <div
              className={`toggle-switch ${audioForward ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setAudioForward(!audioForward);
              }}
            >
              <div className="toggle-knob" />
            </div>
          </button>
          */}

                    <button
                        className="setting-item"
                        onClick={() => {
                            const newValue = !showDeviceSkin;
                            onShowDeviceSkinChange?.(newValue);
                        }}
                    >
                        <div className="setting-info">
                            <Smartphone className="setting-icon" size={16} />
                            <span className="setting-label">Show Device Skin</span>
                        </div>
                        <div
                            className={`toggle-switch ${showDeviceSkin ? 'active' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                const newValue = !showDeviceSkin;
                                onShowDeviceSkinChange?.(newValue);
                            }}
                        >
                            <div className="toggle-knob" />
                        </div>
                    </button>

                    {/* Gradient Color Pickers */}
                    <button
                        className="setting-item"
                        onClick={() => setShowGradientPicker(!showGradientPicker)}
                    >
                        <div className="setting-info">
                            <Monitor className="setting-icon" size={16} />
                            <span className="setting-label">Change Background Gradient</span>
                        </div>
                        <ChevronDown
                            size={14}
                            style={{
                                transition: 'transform 0.2s ease',
                                transform: showGradientPicker ? 'rotate(180deg)' : 'rotate(0deg)',
                                color: 'var(--vsc-text-muted)',
                            }}
                        />
                    </button>

                    {showGradientPicker && (
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '12px',
                                width: '100%',
                                alignItems: 'stretch',
                                padding: '8px 12px',
                                background: 'var(--vsc-bg)',
                                borderRadius: '8px',
                                marginTop: '-4px',
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px',
                                    width: '100%',
                                }}
                            >
                                <label
                                    style={{
                                        fontSize: '11px',
                                        color: 'var(--vsc-text-muted)',
                                        marginBottom: '4px',
                                    }}
                                >
                                    Color 1
                                </label>
                                <div
                                    style={{
                                        display: 'flex',
                                        gap: '8px',
                                        alignItems: 'center',
                                        width: '100%',
                                        padding: '6px',
                                        background: 'var(--vsc-bg)',
                                        border: '1px solid var(--vsc-border)',
                                        borderRadius: '10px',
                                    }}
                                >
                                    <input
                                        type="color"
                                        value={(() => {
                                            // Convert rgba to hex for color input
                                            const match = gradientColor1.match(
                                                /rgba?\((\d+),\s*(\d+),\s*(\d+)/
                                            );
                                            if (match) {
                                                const r = parseInt(match[1])
                                                    .toString(16)
                                                    .padStart(2, '0');
                                                const g = parseInt(match[2])
                                                    .toString(16)
                                                    .padStart(2, '0');
                                                const b = parseInt(match[3])
                                                    .toString(16)
                                                    .padStart(2, '0');
                                                return `#${r}${g}${b}`;
                                            }
                                            return '#eeaeca';
                                        })()}
                                        onChange={(e) => {
                                            const newColor = e.target.value;
                                            // Convert hex to rgba
                                            const r = parseInt(newColor.slice(1, 3), 16);
                                            const g = parseInt(newColor.slice(3, 5), 16);
                                            const b = parseInt(newColor.slice(5, 7), 16);
                                            const rgbaColor = `rgba(${r}, ${g}, ${b}, 1)`;
                                            onGradientColor1Change?.(rgbaColor);
                                        }}
                                        style={{
                                            width: '40px',
                                            height: '32px',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            backgroundColor: 'transparent',
                                            padding: 0,
                                            outline: 'none',
                                            boxShadow: 'none',
                                        }}
                                    />
                                    <div
                                        style={{
                                            width: 1,
                                            alignSelf: 'stretch',
                                            background: 'var(--vsc-border)',
                                            borderRadius: 1,
                                        }}
                                    />
                                    <input
                                        type="text"
                                        value={gradientColor1}
                                        onChange={(e) => {
                                            onGradientColor1Change?.(e.target.value);
                                        }}
                                        style={{
                                            flex: 1,
                                            padding: '6px 10px',
                                            background: 'transparent',
                                            border: 'none',
                                            borderRadius: '8px',
                                            color: 'var(--vsc-text)',
                                            fontSize: '11px',
                                        }}
                                        placeholder="rgba(238, 174, 202, 1)"
                                    />
                                </div>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px',
                                    width: '100%',
                                }}
                            >
                                <label
                                    style={{
                                        fontSize: '11px',
                                        color: 'var(--vsc-text-muted)',
                                        marginBottom: '4px',
                                    }}
                                >
                                    Color 2
                                </label>
                                <div
                                    style={{
                                        display: 'flex',
                                        gap: '8px',
                                        alignItems: 'center',
                                        width: '100%',
                                        padding: '6px',
                                        background: 'var(--vsc-bg)',
                                        border: '1px solid var(--vsc-border)',
                                        borderRadius: '10px',
                                    }}
                                >
                                    <input
                                        type="color"
                                        value={(() => {
                                            // Convert rgba to hex for color input
                                            const match = gradientColor2.match(
                                                /rgba?\((\d+),\s*(\d+),\s*(\d+)/
                                            );
                                            if (match) {
                                                const r = parseInt(match[1])
                                                    .toString(16)
                                                    .padStart(2, '0');
                                                const g = parseInt(match[2])
                                                    .toString(16)
                                                    .padStart(2, '0');
                                                const b = parseInt(match[3])
                                                    .toString(16)
                                                    .padStart(2, '0');
                                                return `#${r}${g}${b}`;
                                            }
                                            return '#94bbe9';
                                        })()}
                                        onChange={(e) => {
                                            const newColor = e.target.value;
                                            // Convert hex to rgba
                                            const r = parseInt(newColor.slice(1, 3), 16);
                                            const g = parseInt(newColor.slice(3, 5), 16);
                                            const b = parseInt(newColor.slice(5, 7), 16);
                                            const rgbaColor = `rgba(${r}, ${g}, ${b}, 1)`;
                                            onGradientColor2Change?.(rgbaColor);
                                        }}
                                        style={{
                                            width: '40px',
                                            height: '32px',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            backgroundColor: 'transparent',
                                            padding: 0,
                                            outline: 'none',
                                            boxShadow: 'none',
                                        }}
                                    />
                                    <div
                                        style={{
                                            width: 1,
                                            alignSelf: 'stretch',
                                            background: 'var(--vsc-border)',
                                            borderRadius: 1,
                                        }}
                                    />
                                    <input
                                        type="text"
                                        value={gradientColor2}
                                        onChange={(e) => {
                                            onGradientColor2Change?.(e.target.value);
                                        }}
                                        style={{
                                            flex: 1,
                                            padding: '6px 10px',
                                            background: 'transparent',
                                            border: 'none',
                                            borderRadius: '8px',
                                            color: 'var(--vsc-text)',
                                            fontSize: '11px',
                                        }}
                                        placeholder="rgba(148, 187, 233, 1)"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Device Skin Color Picker */}
                    <button
                        className="setting-item"
                        onClick={() => setShowSkinColorPicker(!showSkinColorPicker)}
                    >
                        <div className="setting-info">
                            <Smartphone className="setting-icon" size={16} />
                            <span className="setting-label">Change Device Skin Color</span>
                        </div>
                        <ChevronDown
                            size={14}
                            style={{
                                transition: 'transform 0.2s ease',
                                transform: showSkinColorPicker ? 'rotate(180deg)' : 'rotate(0deg)',
                                color: 'var(--vsc-text-muted)',
                            }}
                        />
                    </button>

                    {showSkinColorPicker && (
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                                width: '100%',
                                padding: '8px 12px',
                                background: 'var(--vsc-bg)',
                                borderRadius: '8px',
                                marginTop: '-4px',
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    gap: '8px',
                                    alignItems: 'center',
                                    width: '100%',
                                }}
                            >
                                <input
                                    type="color"
                                    value={(() => {
                                        // Convert hex to hex for color input (already hex)
                                        if (deviceSkinColor?.startsWith('#')) {
                                            return deviceSkinColor;
                                        }
                                        // Try to convert rgba to hex if needed
                                        const match = deviceSkinColor?.match(
                                            /rgba?\((\d+),\s*(\d+),\s*(\d+)/
                                        );
                                        if (match) {
                                            const r = parseInt(match[1])
                                                .toString(16)
                                                .padStart(2, '0');
                                            const g = parseInt(match[2])
                                                .toString(16)
                                                .padStart(2, '0');
                                            const b = parseInt(match[3])
                                                .toString(16)
                                                .padStart(2, '0');
                                            return `#${r}${g}${b}`;
                                        }
                                        return '#1a1a1a';
                                    })()}
                                    onChange={(e) => {
                                        const newColor = e.target.value;
                                        onDeviceSkinColorChange?.(newColor);
                                    }}
                                    style={{
                                        width: '40px',
                                        height: '32px',
                                        border: '1px solid var(--vsc-border)',
                                        borderRadius: '8px',
                                        cursor: 'pointer',
                                        backgroundColor: 'transparent',
                                        outline: 'none',
                                        boxShadow: 'none',
                                    }}
                                />
                                <input
                                    type="text"
                                    value={deviceSkinColor}
                                    onChange={(e) => {
                                        onDeviceSkinColorChange?.(e.target.value);
                                    }}
                                    style={{
                                        flex: 1,
                                        padding: '6px 10px',
                                        background: 'var(--vsc-bg)',
                                        border: '1px solid var(--vsc-border)',
                                        borderRadius: '4px',
                                        color: 'var(--vsc-text)',
                                        fontSize: '11px',
                                    }}
                                    placeholder="#1a1a1a"
                                />
                            </div>
                            <div
                                style={{
                                    fontSize: '10px',
                                    color: 'var(--vsc-text-muted)',
                                }}
                            >
                                Second color is automatically generated (darker)
                            </div>
                        </div>
                    )}

                    {/* Divider */}
                    <div
                        style={{
                            height: '1px',
                            background: 'var(--vsc-border)',
                            margin: '8px 0',
                        }}
                    />

                    {/* Reset Settings Button */}
                    <button
                        className="setting-item"
                        onClick={() => setShowResetConfirm(true)}
                        style={{ color: 'var(--vsc-red)' }}
                    >
                        <div className="setting-info">
                            <RotateCcw
                                className="setting-icon"
                                size={16}
                                style={{ color: 'var(--vsc-red)' }}
                            />
                            <span className="setting-label" style={{ color: 'var(--vsc-red)' }}>
                                Reset All Settings
                            </span>
                        </div>
                    </button>

                    {/* Reset Confirmation Dialog */}
                    {showResetConfirm && (
                        <div
                            style={{
                                position: 'fixed',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                background: 'rgba(0, 0, 0, 0.6)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 1000,
                            }}
                            onClick={() => setShowResetConfirm(false)}
                        >
                            <div
                                style={{
                                    background: 'var(--vsc-secondary)',
                                    borderRadius: '12px',
                                    padding: '20px',
                                    maxWidth: '320px',
                                    width: '90%',
                                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                                    border: '1px solid var(--vsc-border)',
                                }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        marginBottom: '16px',
                                    }}
                                >
                                    <div
                                        style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '10px',
                                            background: 'rgba(255, 100, 100, 0.15)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <AlertTriangle size={20} style={{ color: 'var(--vsc-red)' }} />
                                    </div>
                                    <div>
                                        <div
                                            style={{
                                                fontSize: '14px',
                                                fontWeight: 600,
                                                color: 'var(--vsc-text)',
                                            }}
                                        >
                                            Reset All Settings?
                                        </div>
                                        <div
                                            style={{
                                                fontSize: '11px',
                                                color: 'var(--vsc-text-muted)',
                                                marginTop: '2px',
                                            }}
                                        >
                                            This cannot be undone
                                        </div>
                                    </div>
                                </div>
                                <div
                                    style={{
                                        fontSize: '12px',
                                        color: 'var(--vsc-text-muted)',
                                        marginBottom: '20px',
                                        lineHeight: '1.5',
                                    }}
                                >
                                    All your customizations will be lost, including gradient colors,
                                    device skin settings, quality preferences, and cursor style.
                                </div>
                                <div
                                    style={{
                                        display: 'flex',
                                        gap: '10px',
                                        justifyContent: 'flex-end',
                                    }}
                                >
                                    <button
                                        className="btn"
                                        onClick={() => setShowResetConfirm(false)}
                                        style={{
                                            padding: '8px 16px',
                                            background: 'var(--vsc-bg)',
                                            border: '1px solid var(--vsc-border)',
                                            borderRadius: '8px',
                                            color: 'var(--vsc-text)',
                                            fontSize: '12px',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="btn"
                                        onClick={() => {
                                            onResetSettings?.();
                                            setShowResetConfirm(false);
                                            onClose();
                                        }}
                                        style={{
                                            padding: '8px 16px',
                                            background: 'var(--vsc-red)',
                                            border: 'none',
                                            borderRadius: '8px',
                                            color: 'white',
                                            fontSize: '12px',
                                            cursor: 'pointer',
                                            fontWeight: 500,
                                        }}
                                    >
                                        Reset Settings
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
