import Foundation

/// iPhone/iPad of Mac (Mac Catalyst, zelfde target; zie ios/project.yml). Voor teksten en kleine verschillen; echte
/// Mac-only of iOS-only API's staan achter `#if targetEnvironment(macCatalyst)`.
enum Platform {
    #if targetEnvironment(macCatalyst)
    static let isMac = true
    #else
    static let isMac = false
    #endif
}
