import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';
import { Circle, Svg } from 'react-native-svg';

export function TrafficIndicator({ percentage, color, hasData, textSecondaryColor }: { percentage: number; color: string; hasData: boolean; textSecondaryColor: string }) {
    const size = 160;

    if (hasData) {
        const strokeWidth = 5;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percentage / 100) * circumference;

        return (
            <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    <Circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke="#E5E5EA"
                        strokeWidth={strokeWidth}
                        fill="none"
                    />
                    <Circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke={color}
                        strokeWidth={strokeWidth}
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        rotation="-90"
                        origin={`${size / 2}, ${size / 2}`}
                    />
                </Svg>
                <Text style={{ position: 'absolute', fontSize: 28, fontWeight: '600', color }}>
                    {Math.round(percentage)}%
                </Text>
            </View>
        );
    }

    return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Ionicons name="cloud-circle" size={128} color={textSecondaryColor} />
        </View>
    );
}
