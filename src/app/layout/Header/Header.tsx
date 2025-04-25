'use client'

import { useState } from 'react'
import { Dialog, DialogPanel } from '@headlessui/react'
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline'
import { useAuth } from '@/app/hooks/useAuth'
import Link from 'next/link'
import { BounceLoader } from 'react-spinners';
import { Link as ScrollLink } from 'react-scroll';
import { Tooltip } from 'react-tooltip';
import { usePathname } from 'next/navigation'

const homeNavigation = [
    { name: 'Features', scrollTo: 'features-landing' },
    { name: 'How it works', scrollTo: 'how-journaling-works' },
    { name: 'Pricing', scrollTo: 'pricing-landing' },
]

const appNavigation = [
    { name: 'Account Details', href: '/account-details' },
    { name: 'Journals', href: '/entries' },
    { name: 'AI Therapy', href: '/chatbot' },
]

export default function Header() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const { handleLogout, logOutIsLoading, userMetaData, isLoggedIn } = useAuth()
    const pathname = usePathname()

    const toggleDropdown = () => {
        setDropdownOpen(!dropdownOpen)
    }

    const navigation = pathname === '/' ? homeNavigation : appNavigation

    return (
        <>
            {logOutIsLoading && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
                    <div className="text-center text-white flex flex-col items-center">
                        <BounceLoader color="#ffffff" />
                        <p className="mt-4">Logout successful. Returning you to the homepage...</p>
                    </div>
                </div>
            )}
            <header className={`text-white bg-dark w-full z-40 ${pathname === '/' ? 'fixed top-0' : ''}`}>
                <nav aria-label="Global" className="mx-auto flex max-w-7xl items-center justify-between p-6 lg:px-8">
                    <div className="flex lg:flex-1">
                        <Link href="/" className="-m-1.5 p-1.5 flex justify-center items-center">
                            <h1 className="text-xl fontWeight-semibold">HopeLog</h1>
                        </Link>
                    </div>
                    <div className="flex lg:hidden">
                        <button
                            type="button"
                            onClick={() => setMobileMenuOpen(true)}
                            className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5">
                            <span className="sr-only">Open main menu</span>
                            <Bars3Icon aria-hidden="true" className="size-6" />
                        </button>
                    </div>
                    <div className="hidden lg:flex lg:gap-x-12">
                        {pathname === '/' ? (
                            navigation.map((item) => {
                                const homeItem = item as { name: string; scrollTo: string };
                                return (
                                    <ScrollLink
                                        key={homeItem.name}
                                        to={homeItem.scrollTo}
                                        style={{ cursor: 'pointer' }}
                                        smooth={true}
                                        duration={500}
                                        className="-mx-3 block rounded-lg px-3 py-2 text-base/7 font-semibold hover:bg-white-50"
                                    >
                                        {homeItem.name}
                                    </ScrollLink>
                                );
                            })
                        ) : (
                            navigation.map((item) => {
                                const appItem = item as { name: string; href: string };
                                return (
                                    <Link
                                        key={appItem.name}
                                        href={appItem.href}
                                        className="-mx-3 block rounded-lg px-3 py-2 text-base/7 font-semibold hover:bg-white-50"
                                    >
                                        {appItem.name}
                                    </Link>
                                );
                            })
                        )}
                    </div>
                    <div className="hidden lg:flex lg:flex-1 lg:justify-end">
                        {isLoggedIn && userMetaData ? (
                            <>
                                <div className="relative">
                                    <button
                                        onClick={toggleDropdown}
                                        className="flex items-center mr-4 text-sm/6 font-semibold"
                                    >
                                        Welcome {userMetaData.name}
                                        <svg className={`w-4 h-4 ml-1 transform transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                    {dropdownOpen && (
                                        <div className="absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-dark border border-white z-50">
                                            <div className="py-1">
                                                <Link href="/account-details" className="block px-4 py-2 text-sm text-white hover:bg-gray-700">
                                                    Account Details
                                                </Link>
                                                <Link href="/entries" className="block px-4 py-2 text-sm text-white hover:bg-gray-700">
                                                    My Journals
                                                </Link>
                                                <Link href="/chatbot" className="block px-4 py-2 text-sm text-white hover:bg-gray-700">
                                                    AI Therapy
                                                </Link>
                                                <hr className="border-gray-600" />
                                                <Link
                                                    href="/"
                                                    onClick={handleLogout}
                                                    className="block px-4 py-2 text-sm text-white hover:bg-gray-700"
                                                >
                                                    Log out <span aria-hidden="true">&rarr;</span>
                                                </Link>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <><Link
                                href="/login"
                                data-tooltip-id="login-tooltip"
                                className="text-sm/6 font-semibold bg-ascent px-4 py-2 rounded-md text-white"
                            >
                                Get Started
                            </Link><Tooltip
                                    id="login-tooltip"
                                    place="bottom"
                                    content="Login to start your personal growth journey with AI-powered journaling" /></>
                        )}
                    </div>
                </nav>
                <Dialog open={mobileMenuOpen} onClose={setMobileMenuOpen} className="lg:hidden">
                    <div className="fixed inset-0 z-10" />
                    <DialogPanel className="fixed inset-y-0 right-0 z-10 w-full overflow-y-auto bg-dark text-white px-6 py-6 sm:max-w-sm sm:ring-1 sm:ring-white-900/10">
                        <div className="flex items-center justify-between">
                            <Link href="/" className="-m-1.5 p-1.5">
                                <h1 className="text-xl fontWeight-semibold">HopeLog</h1>
                            </Link>
                            <button
                                type="button"
                                onClick={() => setMobileMenuOpen(false)}
                                className="-m-2.5 rounded-md p-2.5"
                            >
                                <span className="sr-only">Close menu</span>
                                <XMarkIcon aria-hidden="true" className="size-6" />
                            </button>
                        </div>
                        <div className="mt-6 flow-root">
                            <div className="-my-6 divide-y divide-white-500/10">
                                <div className="space-y-2 py-6">
                                    {pathname === '/' ? (
                                        navigation.map((item) => {
                                            const homeItem = item as { name: string; scrollTo: string };
                                            return (
                                                <ScrollLink
                                                    key={homeItem.name}
                                                    style={{ cursor: 'pointer' }}
                                                    to={homeItem.scrollTo}
                                                    smooth={true}
                                                    duration={500}
                                                    className="-mx-3 block rounded-lg px-3 py-2 text-base/7 font-semibold hover:bg-white-50"
                                                >
                                                    {homeItem.name}
                                                </ScrollLink>
                                            );
                                        })
                                    ) : (
                                        navigation.map((item) => {
                                            const appItem = item as { name: string; href: string };
                                            return (
                                                <Link
                                                    key={appItem.name}
                                                    href={appItem.href}
                                                    className="-mx-3 block rounded-lg px-3 py-2 text-base/7 font-semibold hover:bg-white-50"
                                                >
                                                    {appItem.name}
                                                </Link>
                                            );
                                        })
                                    )}
                                    {isLoggedIn && userMetaData ? (
                                        <div className="-mx-3 block rounded-lg px-3 py-2.5 text-base/7 font-semibold text-white">
                                            <span className="block mb-4">Welcome {userMetaData.name}</span>
                                            <div className="flex flex-col space-y-4">
                                                <Link
                                                    href="/account-details"
                                                    className="text-sm/6 font-semibold hover:text-gray-300"
                                                >
                                                    Account Details
                                                </Link>
                                                <Link
                                                    href="/entries"
                                                    className="text-sm/6 font-semibold hover:text-gray-300"
                                                >
                                                    My Journals
                                                </Link>
                                                <Link
                                                    href="/chatbot"
                                                    className="text-sm/6 font-semibold hover:text-gray-300"
                                                >
                                                    AI Therapy
                                                </Link>
                                                <Link
                                                    href="/"
                                                    onClick={handleLogout}
                                                    className="text-sm/6 font-semibold hover:text-gray-300"
                                                >
                                                    Log out <span aria-hidden="true">&rarr;</span>
                                                </Link>
                                            </div>
                                        </div>
                                    ) : (
                                        <Link
                                            href="/login"
                                            data-tooltip-id="login-get-started"
                                            className="-mx-3 block rounded-lg px-3 py-2.5 text-base/7 font-semibold bg-ascent text-white text-center mt-4"
                                        >
                                            Get Started
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </div>
                    </DialogPanel>
                </Dialog>
            </header>
        </>
    )
}
