/// Runs one refresh at a time. A call made while one is running waits for it
/// and asks for one more pass, so a burst of Realtime signals and post-action
/// refreshes collapses into at most two reads, and an older read can never land
/// after a newer one.
@MainActor
final class RefreshCoalescer {
    private var task: Task<Void, Never>?
    private var needsAnotherPass = false

    func run(_ work: @escaping @MainActor () async -> Void) async {
        if let task {
            needsAnotherPass = true
            await task.value
            return
        }
        let task = Task { @MainActor in
            repeat {
                self.needsAnotherPass = false
                await work()
            } while self.needsAnotherPass
            self.task = nil
        }
        self.task = task
        await task.value
    }
}
