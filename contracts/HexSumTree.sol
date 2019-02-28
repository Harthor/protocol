pragma solidity ^0.4.24;


library HexSumTree {
    struct Tree {
        uint256 nextKey;
        uint256 rootDepth;
        mapping (uint256 => mapping (uint256 => uint256)) nodes; // depth -> key -> value
    }

    uint256 private constant CHILDREN = 16;
    uint256 private constant MAX_DEPTH = 64;
    uint256 private constant BITS_IN_NIBBLE = 4;
    // TODO: previous constants are correlated
    uint256 private constant INSERTION_DEPTH = 0;
    uint256 private constant BASE_KEY = 0; // tree starts on the very left

    string private constant ERROR_SORTITION_OUT_OF_BOUNDS = "SUM_TREE_SORTITION_OUT_OF_BOUNDS";
    string private constant ERROR_NEW_KEY_NOT_ADJACENT = "SUM_TREE_NEW_KEY_NOT_ADJACENT";

    function init(Tree storage self) internal {
        self.rootDepth = INSERTION_DEPTH + 1;
        self.nextKey = BASE_KEY;
    }

    function insert(Tree storage self, uint256 value) internal returns (uint256) {
        uint256 key = self.nextKey;
        self.nextKey = nextKey(key);

        _set(self, key, value);

        return key;
    }

    function set(Tree storage self, uint256 key, uint256 value) internal {
        require(key <= self.nextKey, ERROR_NEW_KEY_NOT_ADJACENT);
        _set(self, key, value);
    }

    function sortition(Tree storage self, uint256 value) internal view returns (uint256 key) {
        require(totalSum(self) > value, ERROR_SORTITION_OUT_OF_BOUNDS);

        return _sortition(self, value, BASE_KEY, self.rootDepth);
    }

    function _set(Tree storage self, uint256 key, uint256 value) private {
        uint256 oldValue = self.nodes[INSERTION_DEPTH][key];
        self.nodes[INSERTION_DEPTH][key] = value;

        updateSums(self, key, int256(value - oldValue));
    }

    function _sortition(Tree storage self, uint256 value, uint256 node, uint256 depth) private view returns (uint256 key) {
        uint256 checkedValue = 0; // Can optimize by having checkedValue = value - remainingValue

        // Invariant: node has 0's "after the depth" (so no need for `zeroSuffixNibbles`)
        uint256 shift = ((depth - 1) * BITS_IN_NIBBLE);
        for (uint256 i = 0; i < CHILDREN; i++) {
            // shift the iterator and add it to node 0x00..0i00 (for depth = 3)
            uint256 iterator = i << shift;
            uint256 checkingNode = node + iterator;

            uint256 nodeSum = self.nodes[depth - 1][checkingNode];
            if (checkedValue + nodeSum <= value) {
                checkedValue += nodeSum;
            } else if (depth == 1) { // node found at the end of the tree
                return checkingNode;
            } else {
                return _sortition(self, value - checkedValue, checkingNode, depth - 1);
            }
        }
    }

    function updateSums(Tree storage self, uint256 key, int256 delta) private {
        uint256 newRootDepth = sharedPrefix(self.rootDepth, key);

        if (self.rootDepth != newRootDepth) {
            self.nodes[newRootDepth][BASE_KEY] = self.nodes[self.rootDepth][BASE_KEY];
            self.rootDepth = newRootDepth;
        }

        for (uint256 i = 1; i <= self.rootDepth; i++) {
            // TODO: inline
            uint256 ancestorKey = zeroSuffixNibbles(key, i);

            // Invariant: this will never underflow.
            // TODO: overflow?
            self.nodes[i][ancestorKey] = uint256(int256(self.nodes[i][ancestorKey]) + delta);
        }
    }

    function totalSum(Tree storage self) internal view returns (uint256) {
        return self.nodes[self.rootDepth][BASE_KEY];
    }

    function get(Tree storage self, uint256 depth, uint256 key) internal view returns (uint256) {
        return self.nodes[depth][key];
    }

    function nextKey(uint256 fromKey) private pure returns (uint256) {
        return fromKey + 1;
    }

    function zeroSuffixNibbles(uint256 key, uint256 n) internal pure returns (uint256) {
        if (n == MAX_DEPTH) {
            return 0;
        }

        uint256 shift = n * BITS_IN_NIBBLE;
        return (key >> shift) << shift;
    }

    function sharedPrefix(uint256 depth, uint256 key) internal pure returns (uint256) {
        uint256 shift = depth * BITS_IN_NIBBLE;
        uint256 mask = uint256(-1) << shift;
        uint keyAncestor = key & mask;

        if (keyAncestor != BASE_KEY) {
            return depth + 1;
        }

        return depth;
    }
    /*
    function sharedPrefix(uint256 depth, uint256 key) internal pure returns (uint256) {
        uint256 shift = depth * BITS_IN_NIBBLE;
        uint256 mask = uint256(-1) << shift;
        uint keyAncestor = key & mask;

        // in our use case this while should only have 1 iteration,
        // as new keys are always going to be "adjacent"
        while (keyAncestor != BASE_KEY) {
            mask = mask << BITS_IN_NIBBLE;
            keyAncestor &= mask;
            depth++;
        }
        return depth;
    }
    */
}
