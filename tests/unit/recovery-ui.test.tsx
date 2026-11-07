import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
const mocks=vi.hoisted(()=>({client:vi.fn()}));
vi.mock('next/link',()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:vi.fn(),refresh:vi.fn()})}));
vi.mock('@/lib/supabase/browser',()=>({createClient:mocks.client}));
vi.mock('@/lib/supabase/env',()=>({getSupabaseConfig:()=>({url:'https://auth.example',key:'synthetic'}),getSiteOrigin:()=> 'https://paidflow.example'}));
vi.mock('@/app/auth/reset-password/actions',()=>({resetPassword:vi.fn()}));
import {AuthForm} from '@/components/auth/auth-form';
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('recovery security hold',()=>{
  it.each(['forgot','reset'] as const)('disables %s even if authentication is configured',mode=>{
    render(<AuthForm mode={mode}/>);
    expect(screen.getByText(/Password recovery is temporarily unavailable. No reset link will be sent/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:mode==='forgot'?'Send reset link':'Update password'})).toBeDisabled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
