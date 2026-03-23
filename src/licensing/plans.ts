/**
 * LICENSING PLANS CONFIGURATION
 * 
 * Production pricing and plan details.
 */

export interface PricingPlan {
    id: string;
    name: string;
    duration: number; // days
    price: number; // USD
    maxDevices: number;
    features: string[];
    popular?: boolean;
    description: string;
}

export const PRICING_PLANS: PricingPlan[] = [
    {
        id: 'day1',
        name: '1 Day Trial',
        duration: 1,
        price: 99,
        maxDevices: 1,
        features: [
            'Full feature access',
            '1 device activation',
            'Basic support',
            'Perfect for testing'
        ],
        description: 'Try all features for 24 hours'
    },
    {
        id: 'week1',
        name: '7 Days',
        duration: 7,
        price: 150,
        maxDevices: 2,
        features: [
            'Full feature access',
            '2 device activations',
            'Priority support',
            'Best for short projects'
        ],
        popular: true,
        description: 'Most popular for quick projects'
    },
    {
        id: 'week2',
        name: '15 Days',
        duration: 15,
        price: 200,
        maxDevices: 3,
        features: [
            'Full feature access',
            '3 device activations',
            'Priority support',
            'Extended project time'
        ],
        description: 'Extended access for larger projects'
    },
    {
        id: 'month1',
        name: '1 Month',
        duration: 30,
        price: 349,
        maxDevices: 5,
        features: [
            'Full feature access',
            '5 device activations',
            'Premium support',
            'Best value per day'
        ],
        description: 'Best value for serious development'
    }
];

/**
 * Get plan by ID
 */
export function getPlanById(planId: string): PricingPlan | undefined {
    return PRICING_PLANS.find(p => p.id === planId);
}

/**
 * Get plan by duration
 */
export function getPlanByDuration(days: number): PricingPlan | undefined {
    return PRICING_PLANS.find(p => p.duration === days);
}

/**
 * Format price
 */
export function formatPrice(price: number): string {
    return `$${price}`;
}

/**
 * Calculate price per day
 */
export function getPricePerDay(plan: PricingPlan): string {
    const perDay = (plan.price / plan.duration).toFixed(2);
    return `$${perDay}/day`;
}
