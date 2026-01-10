import { useState, useEffect, useCallback } from 'react';
import { vscode } from '../vscode';

interface AppSettings {
    gradientColor1?: string;
    gradientColor2?: string;
    deviceSkinColor?: string;
    showDeviceSkin?: boolean;
    toolbarAtBottom?: boolean;
    autoHide?: boolean;
    touchFeedback?: boolean;
    keyMapping?: boolean;
    audioForward?: boolean;
    quality?: string;
    fps?: string;
    bitrate?: string;
    cursorStyle?: 'crosshair' | 'default';
}

const DEFAULT_SETTINGS: AppSettings = {
    gradientColor1: 'rgba(238, 174, 202, 1)',
    gradientColor2: 'rgba(148, 187, 233, 1)',
    deviceSkinColor: '#1a1a1a',
    showDeviceSkin: false,
    toolbarAtBottom: true,
    autoHide: false,
    touchFeedback: true,
    keyMapping: false,
    audioForward: true,
    quality: '0',
    fps: '60',
    bitrate: '8',
    cursorStyle: 'crosshair',
};

const STORAGE_KEY = 'scrcpy-app-settings';

export function useSettingsStorage() {
    const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load settings from storage on mount
    useEffect(() => {
        try {
            const stored = vscode.getState() as { [key: string]: unknown } | undefined;
            if (stored && stored[STORAGE_KEY]) {
                const loadedSettings = stored[STORAGE_KEY] as AppSettings;

                // Migrate/validate settings - reset to defaults if values are invalid
                const migratedSettings = { ...DEFAULT_SETTINGS, ...loadedSettings };

                // Validate quality (must be 0 for native resolution, or >= 720)
                const qualityNum = parseInt(migratedSettings.quality || '0', 10);
                if (isNaN(qualityNum) || (qualityNum !== 0 && qualityNum < 720)) {
                    migratedSettings.quality = '0';
                }

                // Validate fps (must be 30, 60, or 90)
                if (!['30', '60', '90'].includes(migratedSettings.fps || '')) {
                    migratedSettings.fps = '60';
                }

                // Validate bitrate (must be > 0, default to 8 if invalid)
                const bitrateNum = parseFloat(migratedSettings.bitrate || '8');
                if (isNaN(bitrateNum) || bitrateNum <= 0) {
                    migratedSettings.bitrate = '8';
                }

                setSettings(migratedSettings);

                // Save migrated settings back to storage
                vscode.setState({
                    ...stored,
                    [STORAGE_KEY]: migratedSettings,
                });
            } else {
                setSettings(DEFAULT_SETTINGS);
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
            setSettings(DEFAULT_SETTINGS);
        } finally {
            setIsLoaded(true);
        }
    }, []);

    // Save settings to storage
    const saveSettings = useCallback((newSettings: Partial<AppSettings>) => {
        setSettings((prevSettings) => {
            const updatedSettings = { ...prevSettings, ...newSettings };

            try {
                const currentState = (vscode.getState() as { [key: string]: unknown }) || {};
                vscode.setState({
                    ...currentState,
                    [STORAGE_KEY]: updatedSettings,
                });
            } catch (error) {
                console.error('Failed to save settings:', error);
            }

            return updatedSettings;
        });
    }, []);

    // Update a specific setting
    const updateSetting = useCallback(
        <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
            saveSettings({ [key]: value });
        },
        [saveSettings]
    );

    // Reset all settings to defaults
    const resetSettings = useCallback(() => {
        setSettings(DEFAULT_SETTINGS);
        try {
            const currentState = (vscode.getState() as { [key: string]: unknown }) || {};
            vscode.setState({
                ...currentState,
                [STORAGE_KEY]: DEFAULT_SETTINGS,
            });
        } catch (error) {
            console.error('Failed to reset settings:', error);
        }
    }, []);

    return {
        settings,
        isLoaded,
        saveSettings,
        updateSetting,
        resetSettings,
    };
}
