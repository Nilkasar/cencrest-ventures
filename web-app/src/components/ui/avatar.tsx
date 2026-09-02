import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const avatarVariants = cva(
  'relative inline-flex shrink-0 overflow-hidden rounded-full',
  {
    variants: {
      size: {
        xs: 'h-6 w-6',
        sm: 'h-8 w-8',
        md: 'h-9 w-9',
        lg: 'h-11 w-11',
      },
    },
    defaultVariants: { size: 'md' },
  }
)

const fallbackTextSize: Record<string, string> = {
  xs: 'text-[9px]',
  sm: 'text-[11px]',
  md: 'text-[12px]',
  lg: 'text-[14px]',
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

interface AvatarProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {
  src?: string
  alt?: string
  name?: string
  bordered?: boolean
}

export function Avatar({ className, size, src, alt, name, bordered, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        avatarVariants({ size }),
        bordered && 'ring-2 ring-paper ring-offset-1 ring-offset-ink',
        className
      )}
      {...props}
    >
      <AvatarPrimitive.Image
        src={src}
        alt={alt ?? name ?? ''}
        className="h-full w-full object-cover"
      />
      <AvatarPrimitive.Fallback
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full',
          'bg-ember text-paper font-semibold font-sans',
          fallbackTextSize[size ?? 'md']
        )}
      >
        {name ? getInitials(name) : '?'}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
