package cloud.oneoh.oneboxn.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner

/**
 * Retains one ViewModelStore per import route across configuration changes.
 * Removing a route clears its store so the import coroutine cannot outlive that route.
 */
internal class ImportViewModelStoreRegistry : ViewModel() {
    private val owners = mutableMapOf<String, ImportRouteOwner>()

    fun ownerFor(entryId: String): ViewModelStoreOwner {
        require(entryId.isNotBlank()) { "import route entryId must not be blank" }
        return owners.getOrPut(entryId, ::ImportRouteOwner)
    }

    fun remove(entryId: String) {
        owners.remove(entryId)?.clear()
    }

    fun clearAll() {
        owners.values.forEach(ImportRouteOwner::clear)
        owners.clear()
    }

    override fun onCleared() {
        clearAll()
    }

    private class ImportRouteOwner : ViewModelStoreOwner {
        override val viewModelStore = ViewModelStore()

        fun clear() {
            viewModelStore.clear()
        }
    }
}
